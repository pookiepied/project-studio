/**
 * Code-graph tools — export boundary.
 *
 * Generates and queries a portable code-relationship graph stored under
 * `.studio/graph/`. Consumption is usually a plain read of GRAPH_REPORT.md /
 * graph.json; these tools generate, check freshness, and run targeted traversals.
 */
import { wrapTool } from "../tool-contract.js";
import { graphBuild, graphStatus, graphNeighbors, graphPath, graphImpact } from "./tools.js";

export const buildCodeGraph  = wrapTool("graph_build", graphBuild);
export const codeGraphStatus = wrapTool("graph_status", graphStatus);
export const graphNeighborsTool = wrapTool("graph_neighbors", graphNeighbors);
export const graphPathTool      = wrapTool("graph_path", graphPath);
export const graphImpactTool    = wrapTool("graph_impact", graphImpact);
