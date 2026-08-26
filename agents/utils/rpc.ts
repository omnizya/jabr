/**
 * Shared JSON-RPC 2.0 types and helpers used by A2A server and ACP bridge.
 */

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export function ok(id: number | string | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(
  id: number | string | null,
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
