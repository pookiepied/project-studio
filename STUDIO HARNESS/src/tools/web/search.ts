import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { RetrievalService } from "../../gateway/retrieval/service.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { UNTRUSTED_CONTENT_NOTE } from "./untrusted.js";

/**
 * Searching the web.
 *
 * Which service answers is settings. The model asks a question; it does not
 * choose a vendor, and no vendor name appears in this schema — see ADR 0023 §1.
 */

const WEB_SEARCH_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "web_search" },
  title: "Search the web",
  description:
    "Searches the web and returns the best matches with a short extract of each page. " +
    "Use fetch afterwards to read one of them in full.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

export interface WebSearchInput {
  readonly query: string;
  readonly limit: number;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const SEARCH_DEADLINE_MS = 45_000;

export function createWebSearchTool(
  retrieval: RetrievalService,
): ToolDefinition<WebSearchInput, string> {
  return defineStudioTool({
    descriptor: WEB_SEARCH_DESCRIPTOR,
    resourceKind: "command",
    deadlineMs: SEARCH_DEADLINE_MS,

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.query !== "string" || value.query.trim() === "") {
        throw new ToolError("invalid_input", { message: "query is required." });
      }
      if (
        value.limit !== undefined &&
        (typeof value.limit !== "number" ||
          !Number.isInteger(value.limit) ||
          value.limit < 1 ||
          value.limit > MAX_LIMIT)
      ) {
        throw new ToolError("invalid_input", {
          message: `limit must be a whole number from 1 to ${MAX_LIMIT}.`,
        });
      }

      return {
        query: value.query.trim(),
        limit: (value.limit) ?? DEFAULT_LIMIT,
      };
    },

    /**
     * A search has no destination host of its own — the provider is fixed by
     * settings and the model never names it. Approving "search the web" is one
     * decision, not one per query, so there is nothing narrower to offer.
     */
    resource: () => undefined,

    execute: async (input, context) => {
      const outcome = await retrieval.search(input.query, input.limit, context.signal);

      if (outcome.value.hits.length === 0) {
        return `No results for "${input.query}" (searched with ${outcome.provider}).`;
      }

      const lines: string[] = [];
      lines.push(`Searched with ${outcome.provider}.`);
      if (outcome.fellBackFrom) {
        lines.push(
          `${outcome.fellBackFrom.provider} could not answer (${outcome.fellBackFrom.reason}), so ${outcome.provider} was used.`,
        );
      }
      // A search snippet is text from a page we did not write, arriving by a
      // shorter route than a fetch. Same rule, same label. See ADR 0022 rule 2.
      lines.push(UNTRUSTED_CONTENT_NOTE);
      if (outcome.value.summary) {
        lines.push("", `Provider summary: ${outcome.value.summary}`);
      }

      for (const [index, hit] of outcome.value.hits.entries()) {
        lines.push("", `${index + 1}. ${hit.title || hit.url}`, hit.url);
        if (hit.snippet) lines.push(hit.snippet);
      }

      return lines.join("\n");
    },
  });
}
