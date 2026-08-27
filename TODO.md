# TODO: Jabr Enhancement Roadmap

## 🚀 Priority 1: Plug-and-Play (PnP) Kit ✅
- [x] **Type System Migration** (committed 720c1dd)
  - [x] Updated `agents/types.ts` to A2A v1.0 `AgentCard` schema (`supportedInterfaces`, `tags`, `extensions`, `HandoverRequest`, etc.)
- [x] **Dynamic Agent Registry** (committed 720c1dd)
  - [x] Implemented `DynamicRegistry` class in `agents/adapters/dynamic-registry.ts`
  - [x] Seed URL scanning and `/.well-known/agent-card.json` fetching via `AgentRegistryPort`
  - [x] Tag-based routing in Orchestrator matching tasks against `AgentSkill.tags`
- [x] **A2A Handover Protocol** (committed 720c1dd)
  - [x] `HandoverRequest` type + `encodeHandover`/`decodeHandover` helpers in types.ts
  - [x] `%%HANDOVER%%` sentinel marker for specialist→orchestrator transfer signals
  - [x] Recursive routing in Orchestrator (`MAX_HANDOVER_DEPTH = 3`)

## 📡 Priority 2: Live Context Kit (MCP Evolution) ✅
- [x] **MCP Resource Infrastructure**
  - [x] Resource types in `agents/types.ts` (`McpResource`, `McpResourceContent`, `ResourceSubscription`, `WorldState`)
  - [x] `ResourcePort` interface in `agents/ports/resource-port.ts`
  - [x] Resource adapter in `agents/adapters/mcp-resources.ts` — registers 4 resources on McpServer
  - [x] Resources wired in `mcp-servers/tools.ts` with default context
  - [x] Declare `subscribe` and `listChanged` capabilities in the MCP server
- [x] **Subscription Management**
  - [x] `SubscriptionManager` class in `agents/adapters/subscription-manager.ts`
  - [x] `subscribe()`/`unsubscribe()`/`hasSubscribers()`/`getSubscriberIds()` methods
  - [x] Integrate `subscriptions/listen` flow and handle `notifications/resources/updated`
- [x] **World-State Resource**
  - [x] `jabr://world-state` — JSON system snapshot (agents, tasks, memory, skills)
  - [x] `jabr://tasks/{taskId}` — individual task state (URI template)
  - [x] `jabr://skills` — saved skill catalog
  - [x] `jabr://memory` — session memory markdown
  - [x] Wire live data callbacks from Orchestrator's task store and agent registry

## 🖥️ Priority 3: IDE-Native Kit (ACP Evolution)
- [ ] **Diff Streaming**
  - [ ] Extend `stdio-bridge.ts` to support native ACP `diff` content type
  - [ ] Implement `tool_call_update` notification stream for incremental edits
- [ ] **Stateful Session Management**
  - [ ] Implement `session/list` and `session/delete` in ACP adapter
  - [ ] Implement session migration via `session/resume` with `replayFrom`
  - [ ] Persist session metadata (cursor, history) in `MemoryStorePort`

## 🧠 Priority 4: Cognitive Loop Kit (Reasoning Evolution)
- [ ] **Recursive Reasoning**
  - [ ] Prototype recursive tool-use loops via direct LLM API integration (replacing deprecated MCP Sampling)
  - [ ] Implement "Tool-Result Interpretation" phase before returning to main agent
- [ ] **Consensus Engine**
  - [ ] Implement "The Judge Pattern": Multi-agent dispatch → Oracle synthesis
  - [ ] Implement weighted voting based on `AgentCard.successRate`
