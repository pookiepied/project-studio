import { describe, expect, it } from "vitest";

import { readEraProbe } from "../../src/extend/mcp/wire/era.js";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_METHOD_NOT_FOUND,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
} from "../../src/extend/mcp/wire/jsonrpc.js";

function success(result: unknown) {
  return { jsonrpc: "2.0" as const, id: 1, result };
}

function failure(code: number, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    error: { code, message: "no", ...(data === undefined ? {} : { data }) },
  };
}

describe("deciding which MCP a server speaks", () => {
  it("reads a discover result as modern", () => {
    const probe = readEraProbe(success({ tools: [] }));

    expect(probe.era).toBe("modern");
  });

  it("reads method-not-found as legacy, which is the ordinary answer", () => {
    // A legacy server has never heard of `server/discover`. This is the
    // expected path, not a fault, and it is what most servers do today.
    const probe = readEraProbe(failure(JSON_RPC_METHOD_NOT_FOUND));

    expect(probe).toEqual({ era: "legacy", why: "method_not_found" });
  });

  it("reads a refused protocol version as modern, and does not fall back", () => {
    // The row that is easy to get wrong. A modern server that will not speak
    // our version answers with an error. Treating any error as "not modern"
    // would downgrade a server that just told us exactly what it is, and the
    // legacy attempt would then fail with a message about the wrong thing.
    const probe = readEraProbe(
      failure(MCP_UNSUPPORTED_PROTOCOL_VERSION, {
        supported: ["2026-07-28"],
        requested: "2027-01-01",
      }),
    );

    expect(probe).toMatchObject({
      era: "modern",
      unsupportedVersion: true,
      supported: ["2026-07-28"],
    });
  });

  it("reads any reserved MCP code as modern, not only the version one", () => {
    // -32020..-32099 is reserved for MCP. A server raising any of them has
    // demonstrated modern vocabulary. Keying on -32022 alone would misread
    // every other modern refusal as legacy.
    for (const code of [-32020, -32050, -32099]) {
      expect(readEraProbe(failure(code)).era, String(code)).toBe("modern");
    }
  });

  it("keeps an ordinary JSON-RPC error out of the MCP band", () => {
    // -32603 is JSON-RPC's own internal error and says nothing about MCP.
    expect(readEraProbe(failure(JSON_RPC_INTERNAL_ERROR)).era).toBe("legacy");
  });

  it("treats no answer as legacy rather than as a failure", () => {
    // A server that says nothing has demonstrated no modern vocabulary, which
    // is the same evidence a malformed answer gives.
    expect(readEraProbe(undefined)).toEqual({ era: "legacy", why: "no_answer" });
  });

  it("treats something that is not a response as legacy", () => {
    for (const junk of [null, 42, "hello", {}, { jsonrpc: "1.0", id: 1 }]) {
      expect(readEraProbe(junk).era, JSON.stringify(junk)).toBe("legacy");
    }
  });

  it("survives a version error carrying no list of what it supports", () => {
    // The field is optional in practice, and a probe that threw here would
    // turn a recoverable refusal into a dead connection.
    const probe = readEraProbe(failure(MCP_UNSUPPORTED_PROTOCOL_VERSION));

    expect(probe).toMatchObject({ era: "modern", supported: [] });
  });

  it("ignores non-string entries in the supported list", () => {
    const probe = readEraProbe(
      failure(MCP_UNSUPPORTED_PROTOCOL_VERSION, { supported: ["2026-07-28", 7, null] }),
    );

    expect(probe).toMatchObject({ supported: ["2026-07-28"] });
  });
});
