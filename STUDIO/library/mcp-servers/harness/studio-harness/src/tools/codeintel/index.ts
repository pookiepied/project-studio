/**
 * Code-intelligence tools — export boundary.
 *
 * These tools produce *understanding* of a codebase rather than raw file
 * access: structural outlines, symbol locations, import/dependency graphs, and
 * code-oriented project maps. Raw file read/write/search lives in ../filesystem.
 *
 * These tools manage their own timeout + error contracts internally and are
 * re-exported directly.
 */
import { wrapTool } from "../tool-contract.js";
import { findRelatedFiles as _findRelatedFiles } from "./find_related.js";

export { outlineFile }                                from "./outline.js";
export { indexCodebase }                              from "./index_codebase.js";
export { exploreCodebase, searchSymbol, analyzeFile } from "./composite_tools.js";

/** Deterministic file adjacency (tests/styles/types/stories/config for a file). */
export const findRelatedFiles = wrapTool("find_related_files", _findRelatedFiles);
