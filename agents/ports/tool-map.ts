// agents/ports/tool-map.ts
//
// Tool-name → handler function map: standardized registry replacing ad-hoc
// switch/case dispatch inside runAgent() and adapter onTask handlers.
//
// External contract is pinned to McpToolResult (see mcp-tool-port.ts): every
// handler and every dispatch return uses that shape, so migrating callers is
// mechanical and never changes result serialization.

import type { McpToolResult } from "@ports/mcp-tool-port";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single tool-name → handler function map entry. */
export type ToolHandler = (
	toolName: string,
	args: Record<string, unknown>,
) => Promise<McpToolResult>;

/** Map: tool name → handler function. Plain Record for inline object literals. */
export type ToolNameMap = Record<string, ToolHandler>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `ToolNameMap` from a partial set plus an optional fallback.
 *
 * - `entries`   — known tool handlers. Later entries win on key collision.
 * - `fallback`  — invoked when a tool name is not in `entries`. If omitted,
 *                 unknown tools throw `ToolNotFoundError`.
 */
export function buildToolMap(
	entries: ToolNameMap,
	fallback?: ToolHandler,
): ToolNameMap {
	const map: ToolNameMap = { ...entries };
	if (fallback) {
		map["__fallback__"] = fallback;
	}
	return map;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ToolNotFoundError extends Error {
	readonly toolName: string;

	constructor(toolName: string) {
		super(`Tool not registered: "${toolName}"`);
		this.name = "ToolNotFoundError";
		this.toolName = toolName;
	}
}

export class ToolExecutionError extends Error {
	readonly toolName: string;
	override readonly cause: unknown;

	constructor(toolName: string, cause: unknown) {
		super(`Tool "${toolName}" execution failed: ${cause}`);
		this.name = "ToolExecutionError";
		this.toolName = toolName;
		this.cause = cause;
	}
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a tool name through the map.
 *
 * - Known tool → handler is called; thrown errors are caught and re-thrown as
 *   `ToolExecutionError` (caller can catch and convert if desired).
 * - Unknown tool → `fallback` is invoked if present; otherwise
 *   `ToolNotFoundError` is thrown.
 *
 * Returns an `McpToolResult` directly so callers get a uniform shape without
 * writing their own try/catch.
 */
export async function dispatchTool(
	map: ToolNameMap,
	toolName: string,
	args: Record<string, unknown>,
): Promise<McpToolResult> {
	const handler = map[toolName];

	if (!handler) {
		const fb = map["__fallback__"];
		if (fb) {
			return fb(toolName, args);
		}
		throw new ToolNotFoundError(toolName);
	}

	try {
		return await handler(toolName, args);
	} catch (e) {
		throw new ToolExecutionError(toolName, e);
	}
}

/**
 * Like `dispatchTool`, but never throws: all failure modes are converted to
 * `McpToolResult { isError: true }`.
 *
 * Use this at call sites that must always return a result (e.g. MCP client
 * adapters that serialize a response back to the server).
 */
export async function dispatchToolSafe(
	map: ToolNameMap,
	toolName: string,
	args: Record<string, unknown>,
): Promise<McpToolResult> {
	try {
		return await dispatchTool(map, toolName, args);
	} catch (e) {
		if (e instanceof ToolNotFoundError) {
			return {
				content: `Unknown tool: ${e.toolName}`,
				isError: true,
			};
		}
		if (e instanceof ToolExecutionError) {
			const cause =
				e.cause instanceof Error ? e.cause.message : String(e.cause);
			return {
				content: `Tool "${e.toolName}" failed: ${cause}`,
				isError: true,
			};
		}
		return {
			content: `Tool dispatch failed: ${e}`,
			isError: true,
		};
	}
}
