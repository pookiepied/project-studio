import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { parseDestination } from "../../net/destination.js";
import type { RetrievalService } from "../../gateway/retrieval/service.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { UNTRUSTED_CONTENT_NOTE } from "./untrusted.js";

/**
 * Reading one web page.
 *
 * The tool holds no provider. It parses the URL, checks the destination, and
 * hands the rest to `retrieval/` — so which service reads the page is settings,
 * not code, and the schema the model sees never changes when that setting does.
 */

export const FETCH_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "fetch" },
  title: "Read a web page",
  description:
    "Reads one web page and returns its text. Give a full https address. " +
    "Use web_search first when you do not already have the address.",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", minLength: 1 } },
    required: ["url"],
    additionalProperties: false,
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  // Reading the same page twice is safe. Retrying a failed read is not a
  // second purchase or a second message.
  idempotent: true,
};

export interface FetchInput {
  readonly url: string;
}

/** Rendering a page can take a while, and the provider already caps itself. */
const FETCH_DEADLINE_MS = 60_000;

export function createFetchTool(
  retrieval: RetrievalService,
): ToolDefinition<FetchInput, string> {
  return defineStudioTool({
    descriptor: FETCH_DESCRIPTOR,
    // The permission resource is a host, which is a name and not a path. It is
    // matched like a command: exact, no path separators, no globbing upward.
    resourceKind: "command",
    deadlineMs: FETCH_DEADLINE_MS,

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.url !== "string" || value.url.trim() === "") {
        throw new ToolError("invalid_input", { message: "url is required." });
      }
      return { url: value.url.trim() };
    },

    // ADR 0022: the resource is the destination host, derived here from the
    // parsed URL and never taken from a separate model-supplied field. A host
    // the model can spell apart from the URL is a host the model can widen.
    //
    // This also refuses loopback, link-local and private addresses before the
    // permission question is asked, so they are never offered and can never be
    // granted.
    resource: (input) => parseDestination(input.url).host,

    execute: async (input, context) => {
      const destination = parseDestination(input.url);
      const outcome = await retrieval.read(destination.url, context.signal);

      const header = [
        outcome.value.title ? `# ${outcome.value.title}` : undefined,
        `Source: ${destination.url}`,
        `Read by: ${outcome.provider}`,
        outcome.fellBackFrom
          ? `${outcome.fellBackFrom.provider} could not read it (${outcome.fellBackFrom.reason}), so ${outcome.provider} was used.`
          : undefined,
        UNTRUSTED_CONTENT_NOTE,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

      return `${header}\n\n${outcome.value.markdown}`;
    },
  });
}
