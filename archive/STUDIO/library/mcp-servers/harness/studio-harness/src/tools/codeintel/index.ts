/**
 * Code-intelligence tools — export boundary.
 *
 * Only the structural-outline primitive survives here. Higher-level codebase
 * understanding (indexing, symbol search, file analysis, dependency maps) was
 * removed from layer 1 — those are orchestration concerns for a future
 * Explore-agent profile, not primitive tools.
 *
 * outline.ts manages its own timeout + {error} contract internally.
 */
export { outlineFile } from "./outline.js";
