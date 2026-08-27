# TODO: Agent-Lab Enhancement Roadmap

## 🚀 Priority 1: Plug-and-Play (PnP) Kit
- [ ] **Type System Migration**
  - [ ] Update `agents/types.ts` to A2A v1.0 `AgentCard` schema (move `url` to `supportedInterfaces`, add required `skills[].tags`).
- [ ] **Dynamic Agent Registry**
  - [ ] Implement `DynamicRegistry` class to replace hardcoded `agentUrls` in `run/orchestrator.ts`.
  - [ ] Implement seed URL scanning and `/.well-known/agent-card.json` fetching.
  - [ ] Update Orchestrator routing to match tasks against `AgentSkill.tags` and descriptions.
- [ ] **A2A Handover Protocol**
  - [ ] Define `HandoverTask` and `TaskState` transfer objects.
  - [ ] Implement `transfer` signal in specialist agents.
  - [ ] Implement Orchestrator coordination for transparent task re-routing.

## 📡 Priority 2: Live Context Kit (MCP Evolution)
- [ ] **MCP Resource Infrastructure**
  - [ ] Register resources in `mcp-servers/tools.ts` using `server.registerResource()`.
  - [ ] Declare `subscribe` and `listChanged` capabilities in the server.
- [ ] **Subscription Management**
  - [ ] Implement `SubscriptionManager` in Orchestrator to track agent-resource mappings.
  - [ ] Implement `subscriptions/listen` flow and handle `notifications/resources/updated`.
- [ ] **World-State Resource**
  - [ ] Create virtual resource `res://system/state` returning JSON system snapshot.

## 🖥️ Priority 3: IDE-Native Kit (ACP Evolution)
- [ ] **Diff Streaming**
  - [ ] Extend `stdio-bridge.ts` to support native ACP `diff` content type.
  - [ ] Implement `tool_call_update` notification stream for incremental edits.
- [ ] **Stateful Session Management**
  - [ ] Implement `session/list` and `session/delete` in ACP adapter.
  - [ ] Implement session migration via `session/resume` with `replayFrom`.
  - [ ] Persist session metadata (cursor, history) in `MemoryStorePort`.

## 🧠 Priority 4: Cognitive Loop Kit (Reasoning Evolution)
- [ ] **Recursive Reasoning**
  - [ ] Prototype recursive tool-use loops via direct LLM API integration (replacing deprecated MCP Sampling).
  - [ ] Implement "Tool-Result Interpretation" phase before returning to main agent.
- [ ] **Consensus Engine**
  - [ ] Implement "The Judge Pattern": Multi-agent dispatch $\rightarrow$ Oracle synthesis.
  - [ ] Implement weighted voting based on `AgentCard.successRate`.
