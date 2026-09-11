import type { RetrievalService } from "../../gateway/retrieval/service.js";
import type { CallGate } from "../gate.js";
import { createFetchTool } from "./fetch.js";
import { createWebSearchTool } from "./search.js";

export { FETCH_DESCRIPTOR, createFetchTool } from "./fetch.js";
export { WEB_SEARCH_DESCRIPTOR, createWebSearchTool } from "./search.js";
export { UNTRUSTED_CONTENT_NOTE } from "./untrusted.js";

/**
 * The web family: search and fetch.
 *
 * Both declare `network` and nothing else, so neither takes a snapshot — a
 * request is not a local change and there is nothing to restore.
 *
 * They take the retrieval service rather than building one. The tools own the
 * model-facing shape; the subsystem owns the providers, the keys, and the
 * failures. That split is the reason a provider can be added without touching
 * anything in this folder.
 */
export function registerWebTools(gate: CallGate, retrieval: RetrievalService): void {
  gate.register(createWebSearchTool(retrieval));
  gate.register(createFetchTool(retrieval));
}
