# Designer Agent

## Role
Frontend design specialist that produces UI/UX layouts, component specs, and style guides. Returns markdown design guidance; delegates actual implementation to the Fixer agent.

## Seed key / port / protocol
- Seed key: `designer`
- Port: **4004**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)

## Card & skills
`DESIGNER_CARD` (module-level `AgentCard` const) exposes three skills whose tags drive tag-based routing:
- **Layout design** — tags: `layout`, `responsive`, `grid`, `spacing`, `ui`
- **Component design** — tags: `component`, `accessibility`, `interaction`, `button`, `ux`
- **Style guide** — tags: `color`, `palette`, `theme`, `typography`, `design-tokens`

## Behavior
Deterministic keyword matcher — NOT LLM-driven. `executeTask(userText)` lowercases input and branches on `lower.includes(...)`:
- `layout` / `page` / `responsive` → responsive-grid layout guidance (breakpoints, spacing scale, component suggestions)
- `component` / `button` / `card` / `modal` → component design tokens + accessibility notes (touch targets, focus rings, WCAG AA)
- `color` / `palette` / `theme` / `style` → color palette, typography, dark-mode guidance
- fallback → "Designer ready" menu

Returns a plain `string` (no artifacts). A separate `async render(prompt)` method calls `imageGen.generate(prompt)` when an `ImageGenPort` is injected (returns a markdown image link or an error/fallback string) — but `render` is NOT invoked by `execute`, so image generation is currently unused through the normal task path.

## Conventions
Follows the de-facto agent class structure:
- `export const DESIGNER_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter
- Constructor DI: `constructor(private taskStore: TaskStorePort, private imageGen?: ImageGenPort)`
- `async execute(taskId, userText): Promise<void>` → `executeTask`, then `updateState("completed")` + `appendMessage` with `crypto.randomUUID()` messageId

**Ports depended on:** `TaskStorePort`, `ImageGenPort` (optional — image generation dormant in the task path).

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Designer. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
