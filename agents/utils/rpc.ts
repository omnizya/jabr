/**
 * Shared JSON-RPC 2.0 types and helpers used by A2A server and ACP bridge.
 */

interface JSONRPCDefaults {
  jsonrpc: "2.0"
  id: SomeId
}
export type SomeId = number | string | null

export interface JSONRPCRequest extends JSONRPCDefaults {
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse extends JSONRPCDefaults {
  result?: unknown;
  error?: { code: number; message: string };
}

export function ok(id: SomeId,
  result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(
  id: SomeId,
  code: number,
  message: string,
): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const corsHeaders = { "Access-Control-Allow-Origin": "*" } as const;

export const corsPreflightHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;
