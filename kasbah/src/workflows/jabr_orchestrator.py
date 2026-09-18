"""Jabr Orchestrator Workflow - Main integration point for Jabr agents.

This workflow orchestrates tasks across multiple Jabr agents, providing
a unified interface for delegating work to the Jabr multi-agent system.
"""

from typing import Any

import mistralai.workflows as workflows
from pydantic import BaseModel, Field

from .jabr.connector import JabrConfig, JabrConnector
from .jabr.models import AgentType, JabrTask, JabrTaskResult, JabrTaskStatus


class JabrOrchestrationInput(BaseModel):
    """Input for Jabr orchestration workflow."""
    task: str
    target_agents: list[str] = []
    context: dict[str, Any] = {}
    timeout_seconds: int = 30


class JabrOrchestrationOutput(BaseModel):
    """Output from Jabr orchestration workflow."""
    results: dict[str, dict[str, Any]] = {}
    summary: str = ""
    success_count: int = 0
    failure_count: int = 0


# Map string agent names to AgentType enum
AGENT_NAME_MAP: dict[str, AgentType] = {
    "orchestrator": AgentType.ORCHESTRATOR,
    "oracle": AgentType.ORACLE,
    "librarian": AgentType.LIBRARIAN,
    "explorer": AgentType.EXPLORER,
    "designer": AgentType.DESIGNER,
    "fixer": AgentType.FIXER,
    "scientist": AgentType.SCIENTIST,
    "verification": AgentType.VERIFICATION,
    "jarvis": AgentType.JARVIS,
}


@workflows.activity()
async def send_to_agent(
    agent: str,
    task_text: str,
    context: dict[str, Any] = {},
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    """Activity to send a task to a Jabr agent."""
    connector = JabrConnector(JabrConfig(timeout_seconds=timeout_seconds))
    agent_type = AGENT_NAME_MAP.get(agent.lower(), AgentType.ORACLE)
    task = JabrTask(
        text=task_text,
        agent=agent_type,
        context=context,
    )
    result = await connector.send_task(task)
    return result.dict()


@workflows.activity()
async def check_agent_health(
    agent: str,
) -> dict[str, Any]:
    """Activity to check if an agent is healthy."""
    connector = JabrConnector()
    agent_type = AGENT_NAME_MAP.get(agent.lower(), AgentType.ORCHESTRATOR)
    try:
        client = await connector.get_client(agent_type)
        async with client:
            healthy = await client.health_check()
            card = await client.get_agent_card()
            if card:
                return {"healthy": healthy, "name": card.name}
            return {"healthy": healthy, "name": agent}
    except Exception as e:
        return {"healthy": False, "name": agent, "error": str(e)}


@workflows.activity()
async def get_world_state_activity() -> dict[str, Any]:
    """Activity to get the current world state from Jabr."""
    connector = JabrConnector()
    world_state = await connector.get_world_state()
    if world_state:
        return {
            "timestamp": world_state.timestamp,
            "agents": {name: card.dict() for name, card in world_state.agents.items()},
        }
    return {"timestamp": None, "agents": {}}


@workflows.workflow.define(
    name="jabr-orchestrator",
    workflow_display_name="Jabr Orchestrator",
    workflow_description="Orchestrate tasks across Jabr agents",
)
class JabrOrchestratorWorkflow:
    @workflows.workflow.entrypoint
    async def run(
        self, input: JabrOrchestrationInput
    ) -> JabrOrchestrationOutput:
        """Main entrypoint for Jabr orchestration.

        This workflow:
        1. Validates the task and target agents
        2. Discovers available agents (if no specific targets)
        3. Sends tasks to the appropriate agents
        4. Aggregates and summarizes results
        """
        # Create connector with custom timeout
        config = JabrConfig(timeout_seconds=input.timeout_seconds)
        connector = JabrConnector(config)

        # Determine target agents
        target_agents: list[AgentType] = []
        if input.target_agents:
            # Use specified agents
            for agent_name in input.target_agents:
                agent_type = AGENT_NAME_MAP.get(agent_name.lower(), AgentType.ORACLE)
                target_agents.append(agent_type)
        else:
            # Default to oracle for general tasks
            target_agents = [AgentType.ORACLE]

        # Check agent health before sending tasks
        healthy_agents: list[str] = []
        for agent_type in target_agents:
            agent_name = agent_type.value
            health_result = await check_agent_health(agent_name)
            if health_result.get("healthy"):
                healthy_agents.append(agent_name)
            else:
                workflows.logger.warning(
                    f"Agent {health_result.get('name')} is not healthy, skipping"
                )

        if not healthy_agents:
            return JabrOrchestrationOutput(
                summary="No healthy agents available",
                failure_count=len(target_agents),
            )

        # Send tasks to healthy agents
        results = {}
        success_count = 0
        failure_count = 0

        for agent_name in healthy_agents:
            result = await send_to_agent(
                agent=agent_name,
                task_text=input.task,
                context=input.context,
                timeout_seconds=input.timeout_seconds,
            )
            results[agent_name] = result

            if result.get("status") == "COMPLETED":
                success_count += 1
            else:
                failure_count += 1

        # Generate summary
        summary_parts = [
            f"Task: {input.task[:50]}..." if len(input.task) > 50 else f"Task: {input.task}",
            f"Agents contacted: {len(healthy_agents)}",
            f"Successes: {success_count}",
            f"Failures: {failure_count}",
        ]

        if success_count > 0:
            successful_results = [
                r for r in results.values() if r.get("status") == "COMPLETED"
            ]
            if successful_results:
                summary_parts.append(
                    f"First result: {successful_results[0].get('text', '')[:100]}"
                )

        return JabrOrchestrationOutput(
            results=results,
            summary=" | ".join(summary_parts),
            success_count=success_count,
            failure_count=failure_count,
        )


@workflows.workflow.define(
    name="jabr-agent-delegate",
    workflow_display_name="Jabr Agent Delegator",
    workflow_description="Delegate a specific task to a Jabr agent",
)
class JabrAgentDelegateWorkflow:
    @workflows.workflow.entrypoint
    async def run(
        self, input: JabrOrchestrationInput
    ) -> dict[str, Any]:
        """Delegate a task to a specific Jabr agent.

        Simpler workflow for direct agent delegation.
        """
        # Determine target agent
        if input.target_agents:
            agent_name = input.target_agents[0].lower()
        else:
            agent_name = "oracle"

        result = await send_to_agent(
            agent=agent_name,
            task_text=input.task,
            context=input.context,
            timeout_seconds=input.timeout_seconds,
        )
        return result


@workflows.workflow.define(
    name="jabr-health-check",
    workflow_display_name="Jabr Health Check",
    workflow_description="Check health and availability of Jabr agents",
)
class JabrHealthCheckWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, input: dict[str, Any]) -> dict[str, Any]:
        """Check health of all Jabr agents."""
        all_agents = [
            "orchestrator",
            "oracle",
            "librarian",
            "explorer",
            "designer",
            "fixer",
            "scientist",
            "verification",
            "jarvis",
        ]

        results = {}
        for agent_name in all_agents:
            health_result = await check_agent_health(agent_name)
            results[agent_name] = health_result

        world_state = await get_world_state_activity()

        return {
            "agents": results,
            "world_state": world_state,
        }
