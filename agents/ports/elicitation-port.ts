/**
 * Elicitation callback port.
 *
 * MCP servers can pause tool execution mid-call and ask the client to collect
 * structured user input via elicitation/create (MCP SEP-2322). The client
 * surfaces the prompt on whatever surface owns the active session (CLI, TUI,
 * Telegram, Slack, etc.) and returns an ElicitResult.
 *
 * This port decouples the MCP client adapter from whatever surface currently
 * owns the session, so the same adapter works in CLI, TUI, and gateway contexts.
 */

import type { ElicitRequestFormParams, ElicitRequestURLParams, ElicitResult } from "@modelcontextprotocol/sdk/types";

export type ElicitationMode = "form" | "url";

export interface ElicitationRequest {
  /** Which elicitation mode the server requested. */
  mode: ElicitationMode;
  /** Human-readable description of what the server wants and why. */
  message: string;
  /** For form mode: the JSON Schema the server wants the user to fill in. */
  requestedSchema?: Record<string, unknown>;
  /** For URL mode: the URL the user should visit out-of-band. */
  url?: string;
  /** Server-provided opaque ID for tracking this elicitation. */
  elicitationId?: string;
}

/**
 * Normalized outcome returned by the elicitation port to the MCP client
 * adapter, which translates it back to an ElicitResult for the SDK.
 */
export type ElicitationDecision = "accept" | "decline" | "cancel";

/**
 * Implementations of this port are responsible for surfacing an elicitation
 * request on the active session's surface and collecting the user's decision.
 *
 * For CLI/TUI sessions this is a synchronous prompt. For gateway sessions
 * (Telegram/Slack/etc.) the implementation posts a message via the gateway's
 * notify callback and blocks until the user responds on that platform.
 *
 * Always fails closed: any timeout, exception, or missing surface returns
 * "decline" so the server treats it as "user did not approve".
 */
export interface ElicitationPort {
  /**
   * Present the elicitation to the user and return their decision.
   *
   * @param request  The server's elicitation request.
   * @param timeoutMs  Maximum time to wait for a user response (0 = no timeout).
   * @returns        The user's decision: accept, decline, or cancel.
   */
  elicit(request: ElicitationRequest, timeoutMs: number): Promise<ElicitationDecision>;
}

/**
 * Default no-op port that declines every request. Used as a fallback when no
 * concrete port is wired (e.g. headless/single-query mode with no user waiting).
 */
export const NullElicitationPort: ElicitationPort = {
  async elicit(_request, _timeoutMs) {
    return "decline";
  },
};
