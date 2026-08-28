# Fixer Agent

## Role
Bounded implementation specialist that fixes bugs, generates code, runs reviews, and executes Python snippets. Returns markdown (and optional code artifacts); does not edit the live filesystem itself.

## Seed key / port / protocol
- Seed key: `fixer`
- Port: **4005**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)

## Card & skills
`FIXER_CARD` (module-level `AgentCard` const) exposes four skills whose tags drive tag-based routing:
- **Fix bug** — tags: `fix`, `bug`, `error`, `patch`, `repair`, `debug`
- **Write code** — tags: `code`, `implement`, `function`, `algorithm`, `typescript`, `write`
- **Run Python** — tags: `python`, `execute`, `uv`
- **Review code** — tags: `review`, `code-review`

## Behavior
Deterministic keyword matcher — NOT LLM-driven. `executeTask(userText)` lowercases input and branches on `lower.includes(...)`:
- `bug` / `fix` / `error` → bug-fix analysis steps (reproduce, locate, patch, verify)
- `fibonacci` / `fib` → saves a `fibonacci-generation` skill via `skillStore.save(...)` AND returns a `fibonacci.ts` **artifact** (iterative `fib(n)` implementation)
- `review` → code review checklist
- `python` / `uv` → canned Python-via-uv snippet result
- fallback → skeleton "fill in your domain logic" message

Returns `{ text, artifact? }`. Artifacts are attached via `taskStore.appendArtifact`.

## Conventions
Follows the de-facto agent class structure:
- `export const FIXER_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter
- Constructor DI: `constructor(private taskStore: TaskStorePort, private skillStore: SkillStorePort)`
- `async execute(taskId, userText): Promise<void>` → `executeTask`, then `updateState("completed")` + `appendMessage` with `crypto.randomUUID()` messageId; if `artifact`, also `appendArtifact(taskId, { name, parts:[{kind:"text", text: artifact.content}] })`

**Ports depended on:** `TaskStorePort`, `SkillStorePort` (used to persist the fibonacci skill).

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Fixer. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
