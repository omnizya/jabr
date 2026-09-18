"""Pydantic models for Jabr integration."""

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class AgentType(str, Enum):
    """Jabr agent types."""
    ORCHESTRATOR = "orchestrator"
    ORACLE = "oracle"
    LIBRARIAN = "librarian"
    EXPLORER = "explorer"
    DESIGNER = "designer"
    FIXER = "fixer"
    SCIENTIST = "scientist"
    VERIFICATION = "verification"
    JARVIS = "jarvis"
    MCP = "mcp"


class JabrTaskStatus(str, Enum):
    """Task lifecycle status."""
    SUBMITTED = "SUBMITTED"
    WORKING = "WORKING"
    INPUT_REQUIRED = "INPUT-REQUIRED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"
    AUTH_REQUIRED = "AUTH-REQUIRED"
    UNKNOWN = "UNKNOWN"


class JabrTask(BaseModel):
    """A task to be sent to a Jabr agent."""
    text: str = Field(..., description="The task description or prompt")
    agent: AgentType = Field(..., description="Target agent to handle the task")
    context: Optional[dict[str, Any]] = Field(
        default=None, description="Optional context for the task"
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None, description="Optional metadata for tracking"
    )


class JabrTaskResult(BaseModel):
    """Result from a Jabr agent task."""
    text: Optional[str] = Field(default=None, description="The result text")
    data: Optional[dict[str, Any]] = Field(
        default=None, description="Structured result data"
    )
    status: JabrTaskStatus = Field(..., description="Task completion status")
    agent: AgentType = Field(..., description="Agent that processed the task")
    duration_ms: Optional[int] = Field(
        default=None, description="Time taken in milliseconds"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")


class JabrAgentCard(BaseModel):
    """Agent card descriptor (from /.well-known/agent-card.json)."""
    name: str = Field(..., description="Agent name")
    description: Optional[str] = Field(default=None, description="Agent description")
    version: Optional[str] = Field(default=None, description="Agent version")
    capabilities: list[str] = Field(
        default_factory=list, description="List of agent capabilities"
    )
    endpoints: dict[str, str] = Field(
        default_factory=dict, description="Available endpoints"
    )


class JabrWorldState(BaseModel):
    """World state aggregate from Jabr orchestrator."""
    agents: dict[str, JabrAgentCard] = Field(
        default_factory=dict, description="Map of agent name to agent card"
    )
    timestamp: Optional[str] = Field(default=None, description="Last update timestamp")
