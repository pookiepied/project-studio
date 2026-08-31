import { describe, expect, it } from "vitest";

import { modelToolName } from "../../src/application/tool-name.js";

describe("model-facing MCP tool names", () => {
  it("preserves native names", () => {
    expect(modelToolName("native", "web_search")).toBe("web_search");
  });

  it("is injective when server and tool names contain separators", () => {
    const first = modelToolName("mcp:a", "b__c");
    const second = modelToolName("mcp:a__b", "c");

    expect(first).not.toBe(second);
  });
});
