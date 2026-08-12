import { describe, expect, it } from "vitest";

import {
  hashDefinition,
  hashToolDefinition,
} from "../../src/extend/mcp/wire/definition-hash.js";

describe("tool definition hash", () => {
  describe("stability", () => {
    it("is stable across runs, asserted against a literal", () => {
      // This literal was produced by the implementation and is committed so a
      // change to the hash is visible as a test failure rather than a silent
      // drift in what an approval means.
      const hash = hashToolDefinition({
        name: "search",
        description: "Search the docs",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      });
      expect(hash).toBe(
        "fdc5a3acf59f6c70af524f1dfb7db6eae92a1f0e83a60d22778c4be190dcdb22",
      );
    });

    it("hashes the same via the three-argument helper", () => {
      const a = hashToolDefinition({
        name: "search",
        description: "Search the docs",
        inputSchema: { type: "object" },
      });
      const b = hashDefinition("search", "Search the docs", {
        type: "object",
      });
      expect(a).toBe(b);
    });
  });

  describe("key ordering", () => {
    it("is insensitive to object key order at the top level of the schema", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { b: 1, a: 2 },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: 2, b: 1 },
      });
      expect(a).toBe(b);
    });

    it("is insensitive to key order at three nesting levels", () => {
      const schemaA = {
        type: "object",
        properties: {
          b: { type: "string", enum: ["y", "x"] },
          a: {
            type: "object",
            properties: {
              d: { type: "number" },
              c: { type: "string" },
            },
          },
        },
      };
      const schemaB = {
        properties: {
          a: {
            properties: {
              c: { type: "string" },
              d: { type: "number" },
            },
            type: "object",
          },
          b: { enum: ["y", "x"], type: "string" },
        },
        type: "object",
      };
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: schemaA,
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: schemaB,
      });
      expect(a).toBe(b);
    });

    it("is insensitive to key order inside nested objects within arrays", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: [{ b: 1, a: 2 }, { d: 3, c: 4 }],
            },
          },
        },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: {
          properties: {
            items: {
              items: [{ a: 2, b: 1 }, { c: 4, d: 3 }],
              type: "array",
            },
          },
          type: "object",
        },
      });
      expect(a).toBe(b);
    });
  });

  describe("array order", () => {
    it("is sensitive to array order", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { enum: ["a", "b"] },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { enum: ["b", "a"] },
      });
      expect(a).not.toBe(b);
    });

    it("is sensitive to array order inside nested structures", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { items: [1, 2, 3] },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { items: [3, 2, 1] },
      });
      expect(a).not.toBe(b);
    });
  });

  describe("inputs that change the hash", () => {
    it("changing the name changes the hash", () => {
      const base = {
        description: "desc",
        inputSchema: { type: "object" },
      };
      const a = hashToolDefinition({ name: "tool-a", ...base });
      const b = hashToolDefinition({ name: "tool-b", ...base });
      expect(a).not.toBe(b);
    });

    it("changing the description changes the hash", () => {
      const base = {
        name: "tool",
        inputSchema: { type: "object" },
      };
      const a = hashToolDefinition({ description: "desc a", ...base });
      const b = hashToolDefinition({ description: "desc b", ...base });
      expect(a).not.toBe(b);
    });

    it("changing the schema changes the hash", () => {
      const base = { name: "tool", description: "desc" };
      const a = hashToolDefinition({
        ...base,
        inputSchema: { type: "object", properties: { a: { type: "string" } } },
      });
      const b = hashToolDefinition({
        ...base,
        inputSchema: { type: "object", properties: { b: { type: "string" } } },
      });
      expect(a).not.toBe(b);
    });

    it("changing a nested schema property changes the hash", () => {
      const base = { name: "tool", description: "desc" };
      const a = hashToolDefinition({
        ...base,
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
      });
      const b = hashToolDefinition({
        ...base,
        inputSchema: { type: "object", properties: { x: { type: "number" } } },
      });
      expect(a).not.toBe(b);
    });
  });

  describe("undefined and null", () => {
    it("treats undefined and a missing key the same", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: 1, b: undefined, c: 2 },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: 1, c: 2 },
      });
      expect(a).toBe(b);
    });

    it("treats nested undefined the same as missing", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: {
          type: "object",
          properties: { x: { type: "string", foo: undefined } },
        },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: {
          type: "object",
          properties: { x: { type: "string" } },
        },
      });
      expect(a).toBe(b);
    });

    it("treats null as a value and not the same as missing", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: 1, b: null },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: 1 },
      });
      expect(a).not.toBe(b);
    });

    it("treats null as different from undefined", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: null },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { a: undefined },
      });
      expect(a).not.toBe(b);
    });
  });

  describe("whitespace", () => {
    it("treats whitespace inside a description as significant", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "hello world",
        inputSchema: { type: "object" },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: "hello  world",
        inputSchema: { type: "object" },
      });
      const c = hashToolDefinition({
        name: "tool",
        description: "hello world\n",
        inputSchema: { type: "object" },
      });
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
      expect(b).not.toBe(c);
    });

    it("does not trim surrounding whitespace", () => {
      const a = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { type: "object" },
      });
      const b = hashToolDefinition({
        name: "tool",
        description: " desc",
        inputSchema: { type: "object" },
      });
      expect(a).not.toBe(b);
    });
  });

  describe("output", () => {
    it("produces a hex SHA-256 string", () => {
      const hash = hashToolDefinition({
        name: "tool",
        description: "desc",
        inputSchema: { type: "object" },
      });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
