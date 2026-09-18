"""Jabr integration module for Kasbah workflows.

This module provides connectors and utilities for integrating Mistral Workflows
with the Jabr multi-agent system via A2A (Agent-to-Agent) communication.
"""

from .connector import JabrConfig, JabrConnector, JabrAgentClient
from .models import (
    JabrTask,
    JabrTaskResult,
    JabrAgentCard,
    JabrWorldState,
    AgentType,
)

__all__ = [
    "JabrConfig",
    "JabrConnector",
    "JabrAgentClient",
    "JabrTask",
    "JabrTaskResult",
    "JabrAgentCard",
    "JabrWorldState",
    "AgentType",
]
