import { describe, expect, it } from "vitest";

import {
  createJsonRpcErrorResponse,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  isMcpErrorCode,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
} from "../../src/extend/mcp/wire/jsonrpc.js";

describe("JSON-RPC 2.0 shapes", () => {
  describe("isJsonRpcRequest", () => {
    it("accepts a minimal request", () => {
      expect(
        isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      ).toBe(true);
    });

    it("accepts a request with a string id and params", () => {
      expect(
        isJsonRpcRequest({
          jsonrpc: "2.0",
          id: "req-1",
          method: "tools/call",
          params: { name: "foo" },
        }),
      ).toBe(true);
    });

    it("accepts a request with numeric id zero", () => {
      expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 0, method: "ping" })).toBe(
        true,
      );
    });

    it("rejects id null — null is not a valid request id", () => {
      expect(
        isJsonRpcRequest({ jsonrpc: "2.0", id: null, method: "ping" }),
      ).toBe(false);
    });

    it("rejects a missing id — that is a notification, not a request", () => {
      expect(isJsonRpcRequest({ jsonrpc: "2.0", method: "ping" })).toBe(false);
    });

    it("rejects a missing jsonrpc field", () => {
      expect(isJsonRpcRequest({ id: 1, method: "ping" })).toBe(false);
    });

    it('rejects jsonrpc "1.0"', () => {
      expect(
        isJsonRpcRequest({ jsonrpc: "1.0", id: 1, method: "ping" }),
      ).toBe(false);
    });

    it("rejects a missing method", () => {
      expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1 })).toBe(false);
    });

    it("rejects a non-string method", () => {
      expect(
        isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: 123 }),
      ).toBe(false);
    });

    it("rejects a request that carries a result", () => {
      expect(
        isJsonRpcRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          result: {},
        }),
      ).toBe(false);
    });

    it("rejects a request that carries an error", () => {
      expect(
        isJsonRpcRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects non-objects", () => {
      expect(isJsonRpcRequest(null)).toBe(false);
      expect(isJsonRpcRequest("string")).toBe(false);
      expect(isJsonRpcRequest(42)).toBe(false);
      expect(isJsonRpcRequest([])).toBe(false);
    });
  });

  describe("isJsonRpcNotification", () => {
    it("accepts a minimal notification", () => {
      expect(
        isJsonRpcNotification({ jsonrpc: "2.0", method: "notifications/ping" }),
      ).toBe(true);
    });

    it("accepts a notification with params", () => {
      expect(
        isJsonRpcNotification({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progress: 1 },
        }),
      ).toBe(true);
    });

    it("rejects a notification that has an id", () => {
      expect(
        isJsonRpcNotification({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ).toBe(false);
    });

    it("rejects id null — a notification is a request with no id, not id null", () => {
      expect(
        isJsonRpcNotification({ jsonrpc: "2.0", id: null, method: "ping" }),
      ).toBe(false);
    });

    it("rejects a missing jsonrpc", () => {
      expect(isJsonRpcNotification({ method: "ping" })).toBe(false);
    });

    it('rejects jsonrpc "1.0"', () => {
      expect(
        isJsonRpcNotification({ jsonrpc: "1.0", method: "ping" }),
      ).toBe(false);
    });

    it("rejects a missing method", () => {
      expect(isJsonRpcNotification({ jsonrpc: "2.0" })).toBe(false);
    });

    it("rejects a notification that carries a result", () => {
      expect(
        isJsonRpcNotification({
          jsonrpc: "2.0",
          method: "ping",
          result: 1,
        }),
      ).toBe(false);
    });

    it("rejects a notification that carries an error", () => {
      expect(
        isJsonRpcNotification({
          jsonrpc: "2.0",
          method: "ping",
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });
  });

  describe("isJsonRpcSuccessResponse", () => {
    it("accepts a success response with an object result", () => {
      expect(
        isJsonRpcSuccessResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { ok: true },
        }),
      ).toBe(true);
    });

    it("accepts a success response with id null", () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "2.0", id: null, result: null }),
      ).toBe(true);
    });

    it("accepts a success response with a string id", () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "2.0", id: "a", result: 42 }),
      ).toBe(true);
    });

    it("rejects a response with both result and error", () => {
      expect(
        isJsonRpcSuccessResponse({
          jsonrpc: "2.0",
          id: 1,
          result: 1,
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects a response with neither result nor error", () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "2.0", id: 1 }),
      ).toBe(false);
    });

    it("rejects a missing jsonrpc", () => {
      expect(isJsonRpcSuccessResponse({ id: 1, result: 1 })).toBe(false);
    });

    it('rejects jsonrpc "1.0"', () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "1.0", id: 1, result: 1 }),
      ).toBe(false);
    });

    it("rejects a missing id", () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "2.0", result: 1 }),
      ).toBe(false);
    });

    it("rejects id null as valid but still checks other fields — here also missing result", () => {
      expect(
        isJsonRpcSuccessResponse({ jsonrpc: "2.0", id: null }),
      ).toBe(false);
    });
  });

  describe("isJsonRpcErrorResponse", () => {
    it("accepts an error response", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Invalid Request" },
        }),
      ).toBe(true);
    });

    it("accepts an error response with data", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "bad", data: { extra: 1 } },
        }),
      ).toBe(true);
    });

    it("accepts an error response with id null", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }),
      ).toBe(true);
    });

    it("rejects a response with both result and error", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          result: 1,
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects a response with neither result nor error", () => {
      expect(isJsonRpcErrorResponse({ jsonrpc: "2.0", id: 1 })).toBe(false);
    });

    it("rejects a missing error", () => {
      expect(
        isJsonRpcErrorResponse({ jsonrpc: "2.0", id: 1 }),
      ).toBe(false);
    });

    it("rejects an error without a code", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects an error without a message", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600 },
        }),
      ).toBe(false);
    });

    it("rejects an error with a non-number code", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: "bad", message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects a missing jsonrpc", () => {
      expect(
        isJsonRpcErrorResponse({
          id: 1,
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });

    it('rejects jsonrpc "1.0"', () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "1.0",
          id: 1,
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });

    it("rejects a missing id", () => {
      expect(
        isJsonRpcErrorResponse({
          jsonrpc: "2.0",
          error: { code: -32600, message: "bad" },
        }),
      ).toBe(false);
    });
  });

  describe("guards are mutually exclusive", () => {
    it("a request is not a notification and not a response", () => {
      const req = { jsonrpc: "2.0", id: 1, method: "ping" };
      expect(isJsonRpcRequest(req)).toBe(true);
      expect(isJsonRpcNotification(req)).toBe(false);
      expect(isJsonRpcSuccessResponse(req)).toBe(false);
      expect(isJsonRpcErrorResponse(req)).toBe(false);
    });

    it("a notification is not a request and not a response", () => {
      const n = { jsonrpc: "2.0", method: "ping" };
      expect(isJsonRpcNotification(n)).toBe(true);
      expect(isJsonRpcRequest(n)).toBe(false);
      expect(isJsonRpcSuccessResponse(n)).toBe(false);
      expect(isJsonRpcErrorResponse(n)).toBe(false);
    });

    it("a success response is not an error response", () => {
      const s = { jsonrpc: "2.0", id: 1, result: 1 };
      expect(isJsonRpcSuccessResponse(s)).toBe(true);
      expect(isJsonRpcErrorResponse(s)).toBe(false);
    });
  });

  describe("reserved error codes", () => {
    it("exposes the JSON-RPC reserved codes", () => {
      expect(JSON_RPC_PARSE_ERROR).toBe(-32700);
      expect(JSON_RPC_INVALID_REQUEST).toBe(-32600);
      expect(JSON_RPC_METHOD_NOT_FOUND).toBe(-32601);
      expect(JSON_RPC_INVALID_PARAMS).toBe(-32602);
      expect(JSON_RPC_INTERNAL_ERROR).toBe(-32603);
    });

    it("exposes the MCP UnsupportedProtocolVersion code", () => {
      expect(MCP_UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022);
    });

    it("recognises the MCP reserved range -32020 to -32099 inclusive", () => {
      expect(isMcpErrorCode(-32020)).toBe(true);
      expect(isMcpErrorCode(-32022)).toBe(true);
      expect(isMcpErrorCode(-32099)).toBe(true);
      expect(isMcpErrorCode(-32050)).toBe(true);
    });

    it("rejects codes outside the MCP range", () => {
      expect(isMcpErrorCode(-32019)).toBe(false);
      expect(isMcpErrorCode(-32100)).toBe(false);
      expect(isMcpErrorCode(-32600)).toBe(false);
      expect(isMcpErrorCode(0)).toBe(false);
    });
  });

  describe("createJsonRpcErrorResponse", () => {
    it("builds an error response from a code and message", () => {
      const resp = createJsonRpcErrorResponse(
        1,
        JSON_RPC_METHOD_NOT_FOUND,
        "Method not found",
      );
      expect(resp).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      });
      expect(isJsonRpcErrorResponse(resp)).toBe(true);
    });

    it("builds an error response with id null", () => {
      const resp = createJsonRpcErrorResponse(
        null,
        JSON_RPC_PARSE_ERROR,
        "Parse error",
      );
      expect(resp.id).toBe(null);
      expect(isJsonRpcErrorResponse(resp)).toBe(true);
    });

    it("includes data when supplied", () => {
      const resp = createJsonRpcErrorResponse(1, -32022, "bad", {
        extra: 1,
      });
      expect(resp.error.data).toEqual({ extra: 1 });
    });

    it("omits data when not supplied", () => {
      const resp = createJsonRpcErrorResponse(1, -32600, "bad");
      expect("data" in resp.error).toBe(false);
    });
  });
});
