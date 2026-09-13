/**
 * JSON-RPC 2.0 shapes as MCP uses them.
 *
 * MCP speaks JSON-RPC 2.0 over the framing in `framing.ts`. This file knows
 * the shape of each message and nothing about transport or correlation — that
 * is 004.C. A notification is a request with no `id`, and the type system
 * keeps them apart rather than a comment that the next reader must remember.
 */

// JSON-RPC 2.0 requires `jsonrpc` to be exactly "2.0".
//
// Exported because whatever sends a message needs the same literal the guards
// check for. Two spellings of "2.0" is one typo away from a client that refuses
// its own messages.
export const JSONRPC_VERSION = "2.0" as const;

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId | null;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcErrorObject;
}

interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// Reserved error codes — Table 5.1 in the JSON-RPC 2.0 specification.
export const JSON_RPC_PARSE_ERROR = -32700 as const;
export const JSON_RPC_INVALID_REQUEST = -32600 as const;
export const JSON_RPC_METHOD_NOT_FOUND = -32601 as const;
export const JSON_RPC_INVALID_PARAMS = -32602 as const;
export const JSON_RPC_INTERNAL_ERROR = -32603 as const;

// MCP reserves -32020 to -32099 for itself (inclusive). The specification
// defines the range as -32099 <= code <= -32020, which is the same interval
// written with the lower bound first.
const JSON_RPC_MCP_MIN_CODE = -32099 as const;
const JSON_RPC_MCP_MAX_CODE = -32020 as const;
export const MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022 as const;

export function isMcpErrorCode(code: number): boolean {
  return code >= JSON_RPC_MCP_MIN_CODE && code <= JSON_RPC_MCP_MAX_CODE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isJsonRpcResponseId(value: unknown): value is JsonRpcId | null {
  return value === null || isJsonRpcId(value);
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  if (!isRecord(value)) return false;
  if (typeof value["code"] !== "number") return false;
  if (typeof value["message"] !== "string") return false;
  // `data` is optional and may be anything.
  return true;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false;
  if (value["jsonrpc"] !== JSONRPC_VERSION) return false;
  if (!isJsonRpcId(value["id"])) return false;
  if (typeof value["method"] !== "string") return false;
  // A request must not carry a result or an error — those belong to responses.
  if ("result" in value) return false;
  if ("error" in value) return false;
  return true;
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  if (!isRecord(value)) return false;
  if (value["jsonrpc"] !== JSONRPC_VERSION) return false;
  if (typeof value["method"] !== "string") return false;
  // A notification has no `id` at all. `null` is not a valid request id and
  // is also not a notification — it is an error response id for a parse
  // failure. `id: undefined` counts as present if the key exists, so the
  // `in` check is required rather than a simple undefined test.
  if ("id" in value) return false;
  if ("result" in value) return false;
  if ("error" in value) return false;
  return true;
}

export function isJsonRpcSuccessResponse(
  value: unknown,
): value is JsonRpcSuccessResponse {
  if (!isRecord(value)) return false;
  if (value["jsonrpc"] !== JSONRPC_VERSION) return false;
  if (!("id" in value)) return false;
  if (!isJsonRpcResponseId(value["id"])) return false;
  if (!("result" in value)) return false;
  if ("error" in value) return false;
  return true;
}

export function isJsonRpcErrorResponse(
  value: unknown,
): value is JsonRpcErrorResponse {
  if (!isRecord(value)) return false;
  if (value["jsonrpc"] !== JSONRPC_VERSION) return false;
  if (!("id" in value)) return false;
  if (!isJsonRpcResponseId(value["id"])) return false;
  if (!("error" in value)) return false;
  if ("result" in value) return false;
  if (!isJsonRpcErrorObject(value["error"])) return false;
  return true;
}

export function createJsonRpcErrorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}
