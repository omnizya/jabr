"""Jabr connector for A2A communication with Jabr agents.

This module provides HTTP-based connectivity to Jabr agents using the
Agent-to-Agent (A2A) protocol with JSON-RPC SendMessage method.
"""

import asyncio
import json
import os
from typing import Any, Optional

import aiohttp
from dotenv import load_dotenv

from .models import (
    AgentType,
    JabrAgentCard,
    JabrTask,
    JabrTaskResult,
    JabrTaskStatus,
    JabrWorldState,
)

# Load environment variables
load_dotenv(override=True)


class JabrConfig:
    """Configuration for Jabr integration."""

    def __init__(
        self,
        orchestrator_url: Optional[str] = None,
        auth_token: Optional[str] = None,
        timeout_seconds: int = 30,
    ):
        self.orchestrator_url = orchestrator_url or os.getenv(
            "JABR_URL", "http://localhost:4000"
        )
        self.auth_token = auth_token or os.getenv("A2A_AUTH_TOKEN")
        self.timeout_seconds = timeout_seconds

    @property
    def agent_ports(self) -> dict[AgentType, int]:
        """Map agent types to their default ports."""
        return {
            AgentType.ORCHESTRATOR: 4000,
            AgentType.ORACLE: 4001,
            AgentType.LIBRARIAN: 4002,
            AgentType.EXPLORER: 4003,
            AgentType.DESIGNER: 4004,
            AgentType.FIXER: 4005,
            AgentType.SCIENTIST: 4006,
            AgentType.VERIFICATION: 4009,
            AgentType.JARVIS: 1337,
            AgentType.MCP: 0,  # stdio, not HTTP
        }

    def get_agent_url(self, agent: AgentType) -> Optional[str]:
        """Get the HTTP URL for a specific agent."""
        port = self.agent_ports.get(agent)
        if port == 0:
            return None  # stdio agents don't have HTTP endpoints

        if agent == AgentType.ORCHESTRATOR:
            return self.orchestrator_url

        # For non-orchestrator agents, derive URL from orchestrator base
        try:
            from urllib.parse import urlparse

            parsed = urlparse(self.orchestrator_url)
            return f"{parsed.scheme}://{parsed.hostname}:{port}"
        except Exception:
            return f"http://localhost:{port}"


class JabrAgentClient:
    """Client for communicating with a specific Jabr agent."""

    def __init__(
        self,
        agent: AgentType,
        config: Optional[JabrConfig] = None,
    ):
        self.agent = agent
        self.config = config or JabrConfig()
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self) -> "JabrAgentClient":
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout_seconds)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._session:
            await self._session.close()

    @property
    def session(self) -> aiohttp.ClientSession:
        if not self._session:
            raise RuntimeError("Session not initialized. Use async context manager.")
        return self._session

    @property
    def url(self) -> Optional[str]:
        """Get the agent's HTTP endpoint."""
        return self.config.get_agent_url(self.agent)

    async def get_agent_card(self) -> Optional[JabrAgentCard]:
        """Fetch the agent card descriptor."""
        if not self.url:
            return None

        try:
            async with self.session.get(
                f"{self.url}/.well-known/agent-card.json"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return JabrAgentCard(**data)
        except Exception:
            return None
        return None

    async def send_task(self, task: JabrTask) -> JabrTaskResult:
        """Send a task to the agent via A2A JSON-RPC.

        Uses the SendMessage JSON-RPC method as per A2A specification.
        """
        if not self.url:
            return JabrTaskResult(
                status=JabrTaskStatus.FAILED,
                agent=self.agent,
                error=f"Agent {self.agent.value} does not have an HTTP endpoint",
            )

        # Build JSON-RPC request
        payload = {
            "jsonrpc": "2.0",
            "method": "SendMessage",
            "params": {
                "text": task.text,
                "context": task.context or {},
                "metadata": task.metadata or {},
            },
            "id": 1,
        }

        headers = {"Content-Type": "application/json"}
        if self.config.auth_token:
            headers["X-API-Key"] = self.config.auth_token

        try:
            async with self.session.post(
                self.url,
                json=payload,
                headers=headers,
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return self._parse_result(result, task)
                else:
                    error_text = await response.text()
                    return JabrTaskResult(
                        status=JabrTaskStatus.FAILED,
                        agent=self.agent,
                        error=f"HTTP {response.status}: {error_text}",
                    )
        except asyncio.TimeoutError:
            return JabrTaskResult(
                status=JabrTaskStatus.FAILED,
                agent=self.agent,
                error=f"Request to {self.agent.value} timed out",
            )
        except Exception as e:
            return JabrTaskResult(
                status=JabrTaskStatus.FAILED,
                agent=self.agent,
                error=f"Error communicating with {self.agent.value}: {str(e)}",
            )

    def _parse_result(
        self, result: dict[str, Any], task: JabrTask
    ) -> JabrTaskResult:
        """Parse JSON-RPC response into JabrTaskResult."""
        # Handle JSON-RPC response structure
        if "result" in result:
            result_data = result["result"]
            return JabrTaskResult(
                text=result_data.get("text"),
                data=result_data.get("data"),
                status=JabrTaskStatus.COMPLETED,
                agent=self.agent,
            )
        elif "error" in result:
            error_data = result["error"]
            return JabrTaskResult(
                status=JabrTaskStatus.FAILED,
                agent=self.agent,
                error=str(error_data),
            )
        else:
            # Direct result format
            return JabrTaskResult(
                text=result.get("text"),
                data=result.get("data"),
                status=JabrTaskStatus.COMPLETED,
                agent=self.agent,
            )

    async def health_check(self) -> bool:
        """Check if the agent is healthy."""
        if not self.url:
            return False

        try:
            async with self.session.get(f"{self.url}/health") as response:
                return response.status == 200
        except Exception:
            return False


class JabrConnector:
    """Main connector for Jabr integration.

    Provides high-level interface for discovering and communicating with
    Jabr agents from Kasbah workflows.
    """

    def __init__(self, config: Optional[JabrConfig] = None):
        self.config = config or JabrConfig()
        self._clients: dict[AgentType, JabrAgentClient] = {}

    async def __aenter__(self) -> "JabrConnector":
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        for client in self._clients.values():
            if client._session:
                await client._session.close()
        self._clients.clear()

    async def get_client(self, agent: AgentType) -> JabrAgentClient:
        """Get a client for a specific agent (creates and caches)."""
        if agent not in self._clients:
            self._clients[agent] = JabrAgentClient(agent, self.config)
        return self._clients[agent]

    async def get_world_state(self) -> Optional[JabrWorldState]:
        """Fetch the world state from the orchestrator."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.config.orchestrator_url}/.well-known/world-state"
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        agents = {}
                        if "agents" in data:
                            for name, card_data in data["agents"].items():
                                try:
                                    agents[name] = JabrAgentCard(**card_data)
                                except Exception:
                                    pass
                        return JabrWorldState(
                            agents=agents,
                            timestamp=data.get("timestamp"),
                        )
        except Exception:
            return None
        return None

    async def send_task(self, task: JabrTask) -> JabrTaskResult:
        """Send a task to a Jabr agent.

        This is the main entry point for workflows to delegate tasks to Jabr agents.
        """
        client = await self.get_client(task.agent)
        async with client:
            return await client.send_task(task)

    async def broadcast_task(
        self,
        text: str,
        agents: list[AgentType],
        context: Optional[dict[str, Any]] = None,
    ) -> dict[AgentType, JabrTaskResult]:
        """Send a task to multiple agents and collect results."""
        results = {}
        tasks = [
            JabrTask(text=text, agent=agent, context=context)
            for agent in agents
        ]

        for task in tasks:
            result = await self.send_task(task)
            results[task.agent] = result

        return results

    async def get_agent_status(
        self, agent: AgentType
    ) -> tuple[bool, Optional[JabrAgentCard]]:
        """Check if an agent is healthy and get its card."""
        client = await self.get_client(agent)
        async with client:
            healthy = await client.health_check()
            card = await client.get_agent_card()
            return healthy, card


# Global default connector instance
_default_connector: Optional[JabrConnector] = None


def get_jabr_connector() -> JabrConnector:
    """Get the default Jabr connector instance."""
    global _default_connector
    if _default_connector is None:
        _default_connector = JabrConnector()
    return _default_connector
