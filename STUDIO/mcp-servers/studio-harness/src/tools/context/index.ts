import { wrapTool } from "../tool-contract.js";
import {
  semanticCodeSearch as a,
  semanticDocumentSearch as b,
  findSimilarImplementation as c,
  findFeatureImplementation as d,
  retrieveContextBundle as e,
  explainRetrieval as f,
  indexStatus as g,
  reindexPaths as h,
} from "./tools.js";
export const semanticCodeSearch = wrapTool("semantic_code_search", a),
  semanticDocumentSearch = wrapTool("semantic_document_search", b),
  findSimilarImplementation = wrapTool("find_similar_implementation", c),
  findFeatureImplementation = wrapTool("find_feature_implementation", d),
  retrieveContextBundle = wrapTool("retrieve_context_bundle", e),
  explainRetrieval = wrapTool("explain_retrieval", f),
  indexStatus = wrapTool("index_status", g),
  reindexPaths = wrapTool("reindex_paths", h);
