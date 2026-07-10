import { wrapTool } from "../tool-contract.js";
import {
  parseFile as a,
  querySyntaxTree as b,
  findStructuralPattern as c,
  structuralReplace as d,
  extractSymbolBody as e,
  findDeadExports as f,
  findDuplicateStructure as g,
  calculateComplexity as h,
  detectSyntaxErrors as i,
} from "./tools.js";
export const parseFile = wrapTool("parse_file", a),
  querySyntaxTree = wrapTool("query_syntax_tree", b),
  findStructuralPattern = wrapTool("find_structural_pattern", c),
  structuralReplace = wrapTool("structural_replace", d),
  extractSymbolBody = wrapTool("extract_symbol_body", e),
  findDeadExports = wrapTool("find_dead_exports", f),
  findDuplicateStructure = wrapTool("find_duplicate_structure", g),
  calculateComplexity = wrapTool("calculate_complexity", h),
  detectSyntaxErrors = wrapTool("detect_syntax_errors", i);
