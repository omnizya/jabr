# Jabr MCP Gap Analysis & Research

**Date:** 2026-08-29
**MCP Spec Version:** 2026-07-28 (Release Candidate)
**Jabr MCP SDK:** @modelcontextprotocol/sdk ^1.30.0

---

## Executive Summary

Jabr's MCP implementation covers only the basic primitives (tools + resources). The MCP specification has evolved significantly — the 2026-07-28 release candidate introduces major features that Jabr is missing: elicitation, sampling, structured output, prompts, roots, completions, and Streamable HTTP transport.

**Critical finding:** Jabr's MCP client (`mcp-client.ts`) uses a raw JSON-RPC implementation that doesn't leverage the SDK's high-level APIs. This means every new MCP feature must be manually implemented.

---

## MCP Primitives — Jabr vs Spec

| Primitive | MCP 2026-07-28 | Jabr Status | Gap |
|-----------|-----------------|-------------|-----|
| **Tools** | ✅ Model-controlled execution | ✅ Implemented | — |
| **Resources** | ✅ Read-only data | ✅ Implemented | — |
| **Prompts** | ✅ Reusable templates | ❌ Missing | High |
| **Sampling** | ✅ Server-side LLM calls | ❌ Missing | High |
| **Elicitation** | ✅ Human-in-the-loop | ❌ Missing | Critical |
| **Roots** | ✅ Workspace boundaries | ❌ Missing | Medium |
| **Completions** | ✅ Autocomplete | ❌ Missing | Low |
| **Tasks** | ✅ Multi-step coordination | ❌ Missing | Medium |

---

## Critical Gaps

### 1. Elicitation (Human-in-the-Loop)

**What it is:** MCP servers can pause tool execution and ask users for input via structured JSON schemas. Two modes:
- **Form mode** — server sends JSON Schema, client renders form, user responds with structured data
- **URL mode** — server sends URL, client opens it, user completes action

**Why Jabr needs it:**
- Scientist agent could ask for parameter tuning during analysis
- Oracle agent could request clarification on ambiguous code review findings
- Fixer agent could ask for confirmation before destructive operations

**Current workaround:** None — agents must guess or use defaults.

**Implementation effort:** 2-3 days

---

### 2. Sampling (Server-Side LLM Calls)

**What it is:** MCP servers can request the client's LLM to generate text on their behalf. The host controls which model is used and can deny the request.

**Why Jabr needs it:**
- MCP tools could leverage LLM reasoning without direct API access
- Scientist agent's Python tools could request narrative interpretation of results
- Librarian agent's search tools could synthesize findings

**Current workaround:** Tools return raw data; agents must interpret it themselves.

**Implementation effort:** 2-3 days

---

### 3. Structured Output (structuredContent)

**What it is:** Tools can return structured JSON values (not just text). Output schemas support composition (`oneOf`, `anyOf`, `allOf`) and conditionals.

**Why Jabr needs it:**
- Tools currently return `{ content: string }` — all output is unstructured text
- Structured output enables programmatic consumption by agents
- Enables validation against JSON Schema

**Current workaround:** Agents parse text output manually (fragile).

**Implementation effort:** 1-2 days

---

### 4. Prompts (Reusable Templates)

**What it is:** MCP servers can expose reusable prompt templates with parameters. Clients can list and execute them.

**Why Jabr needs it:**
- Standardize prompts across agents (code review, simplification, etc.)
- Enable prompt versioning and sharing
- Reduce prompt duplication in agent code

**Current workaround:** Prompts are hardcoded in agent implementations.

**Implementation effort:** 1 day

---

### 5. Roots (Workspace Boundaries)

**What it is:** Clients declare workspace roots to servers. Servers respect these boundaries for file access.

**Why Jabr needs it:**
- Security: prevent agents from accessing files outside workspace
- Multi-tenant support: isolate agent workspaces
- Compliance: enforce access boundaries

**Current workaround:** All tools use `process.cwd()` — no boundary enforcement.

**Implementation effort:** 1 day

---

### 6. Streamable HTTP Transport

**What it is:** MCP 2026-07-28 introduces Streamable HTTP as a first-class transport (not just stdio). Enables:
- Stateless operation
- Cacheable tool catallets
- Gateway routing via HTTP headers
- Global scalability

**Why Jabr needs it:**
- Current stdio transport is fragile (single-process, no reconnection)
- HTTP enables multi-machine deployment
- Enables load balancing across MCP servers

**Current workaround:** stdio only — one MCP server per agent process.

**Implementation effort:** 3-5 days

---

### 7. Multi Round-Trip Requests (MRTR)

**What it is:** MCP 2026-07-28 replaces constantly-open bidirectional streams with MRTR for server-to-client requests (sampling, elicitation).

**Why Jabr needs it:**
- More reliable than persistent streams
- Works with stateless HTTP transport
- Better error recovery

**Current workaround:** Not applicable until Streamable HTTP is implemented.

**Implementation effort:** Included in Streamable HTTP work

---

## Security Gaps

### MCP Security Analysis (arXiv, 2026-01-24)

**Attack vector:** A server initially claiming only `resources` capability can later invoke `sampling/createMessage` to inject prompts. The specification does not mandate capability enforcement at the message level.

**Jabr's exposure:** HIGH — no capability enforcement, no message-level validation.

**Required mitigations:**
1. Capability enforcement at message level
2. Input validation on all tool arguments
3. Output sanitization on all tool results
4. Rate limiting per tool caller
5. Audit logging for all tool invocations

---

## MCP SDK Version Gap

**Jabr uses:** `@modelcontextprotocol/sdk ^1.30.0`
**Latest:** 2026-07-28 specification support

**Missing SDK features:**
- `McpServer` class with full capability negotiation
- `elicitation/create` request handler
- `sampling/createMessage` request handler
- `prompts/list` and `prompts/get` handlers
- `roots/list` change notifications
- `completion/complete` request handler
- `StreamableHTTPServerTransport` class
- `McpMethod` and `Mcp-Name` HTTP headers
- Cache hints for list responses

---

## Recommendations

### Immediate (1-2 weeks)
1. Upgrade MCP SDK to latest version
2. Implement elicitation support (highest user value)
3. Add structured output to all tools
4. Add capability enforcement at message level

### Short-term (2-4 weeks)
5. Implement sampling support
6. Add prompt templates for common agent operations
7. Implement roots for workspace boundary enforcement
8. Add completion support for tool arguments

### Medium-term (1-2 months)
9. Migrate to Streamable HTTP transport
10. Implement MRTR for server-to-client requests
11. Add HTTP header-based routing
12. Implement tool catalog caching

---

## Research Sources

- [MCP 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP Elicitation Demo](https://github.com/mcp-use/mcp-elicitation-demo)
- [MCP Security Analysis (arXiv)](https://arxiv.org/html/2601.17549v1)
- [MCP Cheat Sheet 2026](https://www.webfuse.com/mcp-cheat-sheet)
- [MCP Specification Timeline](https://hidekazu-konishi.com/entry/mcp_specification_version_timeline.html)
- [Cloudflare Agents SDK MCP Support](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
