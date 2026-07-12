import { readFile, readManyFiles, fileMetadata, detectBinary, contentHash, watchFiles, editFile, multiEditFile, writeFile, globFiles, grepFiles, listDirectory, deleteFile, moveFile } from "./tools/filesystem/index.js";
import { readNotebook } from "./tools/notebook/index.js";
import { readArchiveManifest } from "./tools/archive/index.js";
import { outlineFile, indexCodebase, exploreCodebase, searchSymbol, analyzeFile, findRelatedFiles } from "./tools/codeintel/index.js";
import { buildCodeGraph, codeGraphStatus, graphNeighborsTool, graphPathTool, graphImpactTool } from "./tools/graph/index.js";
import {
  executeBash, executePowerShell, runRepl,
  startProcess, readProcessOutput, writeProcessInput, stopProcess, listProcesses, commandExists,
} from "./tools/execution/index.js";
import {
  gitStatus, gitDiff, gitLog, gitCommit, gitBranch, gitPush, gitPull, gitFetch, gitShow, gitStash, gitWorktree,
  gitInit, gitAdd, gitReset, gitRestore, gitRm, gitMv, gitMerge, gitRebase, gitCherryPick, gitRevert,
  gitTag, gitRemote, gitClone, gitBlame, gitClean, gitReflog, gitConfig, searchGitHistory,
} from "./tools/git/index.js";
import { searchText, searchFiles, searchIdentifiers, searchImports, searchConfig, searchTodos } from "./tools/search/index.js";
import { semanticCodeSearch, semanticDocumentSearch, findSimilarImplementation, findFeatureImplementation, retrieveContextBundle, explainRetrieval, indexStatus, reindexPaths } from "./tools/context/index.js";
import { parseFile, querySyntaxTree, findStructuralPattern, structuralReplace, extractSymbolBody, findDeadExports, findDuplicateStructure, calculateComplexity, detectSyntaxErrors } from "./tools/syntax/index.js";
import { askUserQuestion } from "./tools/interaction/index.js";
import { sleep } from "./tools/utils/index.js";
import { runLsp, navigateSymbol, findSymbolRelationships, inspectSymbol, diagnostics, renameSymbol, codeActions, formatCode } from "./tools/lsp/index.js";
import { LSP_TOOL_DEFINITION } from "./tools/lsp/definitions.js";
import { IDE_DEFINITIONS } from "./tools/lsp/ide-definitions.js";
import { executeSshCommand, manageSshSession } from "./tools/network/index.js";
import { finalizeToolDefinitions } from "./tool-schema.js";

// Tool schema definitions are co-located with their handler folder. Each folder
// owns both its implementation and the JSON schema the AI sees via tools/list.
import { EXECUTION_DEFINITIONS }   from "./tools/execution/definitions.js";
import { NETWORK_DEFINITIONS }     from "./tools/network/definitions.js";
import { FILESYSTEM_DEFINITIONS }  from "./tools/filesystem/definitions.js";
import { CODEINTEL_DEFINITIONS }   from "./tools/codeintel/definitions.js";
import { GIT_DEFINITIONS }         from "./tools/git/definitions.js";
import { UTILS_DEFINITIONS }       from "./tools/utils/definitions.js";
import { INTERACTION_DEFINITIONS } from "./tools/interaction/definitions.js";
import { NOTEBOOK_DEFINITIONS }    from "./tools/notebook/definitions.js";
import { ARCHIVE_DEFINITIONS }     from "./tools/archive/definitions.js";
import { SEARCH_DEFINITIONS }      from "./tools/search/definitions.js";
import { CONTEXT_DEFINITIONS }     from "./tools/context/definitions.js";
import { SYNTAX_DEFINITIONS }      from "./tools/syntax/definitions.js";
import { GRAPH_DEFINITIONS }       from "./tools/graph/definitions.js";

// ---------------------------------------------------------------------------
// Tool definitions (schema sent to the AI via tools/list)
//
// Composed from the per-folder definition arrays. This file only declares the
// ORDER tools are advertised in — to change a tool's schema, edit the
// definitions.ts in its folder, not here.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = finalizeToolDefinitions([
  ...EXECUTION_DEFINITIONS,   // bash, powershell, repl
  ...NETWORK_DEFINITIONS,     // ssh_exec, ssh_session (remote command execution)
  ...FILESYSTEM_DEFINITIONS,  // read/edit/write/delete/move, glob, grep, ls
  ...NOTEBOOK_DEFINITIONS,
  ...ARCHIVE_DEFINITIONS,
  ...SEARCH_DEFINITIONS,      // bounded lexical, file, identifier, import, config, marker search
  ...CONTEXT_DEFINITIONS,     // semantic, graph-enriched context retrieval and index control
  ...SYNTAX_DEFINITIONS,      // Tree-sitter parsing, structural analysis, and safe rewriting
  ...CODEINTEL_DEFINITIONS,   // outline, index_codebase, explore, search_symbol, analyze, find_related
  ...GRAPH_DEFINITIONS,       // portable code-relationship graph: build, status, neighbors, path, impact
  ...GIT_DEFINITIONS,         // full git surface: status/diff/log/commit/branch/push/pull/fetch/show/stash/worktree + init/add/reset/restore/rm/mv/merge/rebase/cherry-pick/revert/tag/remote/clone/blame/clean/reflog/config
  ...UTILS_DEFINITIONS,       // sleep
  LSP_TOOL_DEFINITION,        // lsp
  ...IDE_DEFINITIONS,         // structured IDE navigation, diagnostics, and safe semantic edits
  ...INTERACTION_DEFINITIONS, // ask_user_question
]);

// ---------------------------------------------------------------------------
// Dispatch — maps tool name → handler function
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export const HANDLERS: Record<string, ToolHandler> = {
  bash: executeBash,
  powershell: executePowerShell,
  repl: runRepl,
  start_process: startProcess,
  read_process_output: readProcessOutput,
  write_process_input: writeProcessInput,
  stop_process: stopProcess,
  list_processes: listProcesses,
  command_exists: commandExists,
  ssh_exec: executeSshCommand,
  ssh_session: manageSshSession,
  read_file: readFile,
  read_many_files: readManyFiles,
  file_metadata: fileMetadata,
  detect_binary: detectBinary,
  content_hash: contentHash,
  watch_files: watchFiles,
  read_notebook: readNotebook,
  read_archive_manifest: readArchiveManifest,
  edit_file: editFile,
  multi_edit: multiEditFile,
  write_file: writeFile,
  delete_file: deleteFile,
  move_file: moveFile,
  glob: globFiles,
  grep: grepFiles,
  ls: listDirectory,
  outline_file: outlineFile,
  index_codebase: indexCodebase,
  explore_codebase: exploreCodebase,
  search_symbol: searchSymbol,
  analyze_file: analyzeFile,
  find_related_files: findRelatedFiles,
  graph_build: buildCodeGraph,
  graph_status: codeGraphStatus,
  graph_neighbors: graphNeighborsTool,
  graph_path: graphPathTool,
  graph_impact: graphImpactTool,
  git_status: gitStatus,
  git_diff: gitDiff,
  git_log: gitLog,
  git_commit: gitCommit,
  git_branch: gitBranch,
  git_push: gitPush,
  git_pull: gitPull,
  git_fetch: gitFetch,
  git_show: gitShow,
  git_stash: gitStash,
  git_worktree: gitWorktree,
  git_init: gitInit,
  git_add: gitAdd,
  git_reset: gitReset,
  git_restore: gitRestore,
  git_rm: gitRm,
  git_mv: gitMv,
  git_merge: gitMerge,
  git_rebase: gitRebase,
  git_cherry_pick: gitCherryPick,
  git_revert: gitRevert,
  git_tag: gitTag,
  git_remote: gitRemote,
  git_clone: gitClone,
  git_blame: gitBlame,
  git_clean: gitClean,
  git_reflog: gitReflog,
  git_config: gitConfig,
  search_git_history: searchGitHistory,
  search_text: searchText,
  search_files: searchFiles,
  search_identifiers: searchIdentifiers,
  search_imports: searchImports,
  search_config: searchConfig,
  search_todos: searchTodos,
  semantic_code_search: semanticCodeSearch,
  semantic_document_search: semanticDocumentSearch,
  find_similar_implementation: findSimilarImplementation,
  find_feature_implementation: findFeatureImplementation,
  retrieve_context_bundle: retrieveContextBundle,
  explain_retrieval: explainRetrieval,
  index_status: indexStatus,
  reindex_paths: reindexPaths,
  parse_file: parseFile,
  query_syntax_tree: querySyntaxTree,
  find_structural_pattern: findStructuralPattern,
  structural_replace: structuralReplace,
  extract_symbol_body: extractSymbolBody,
  find_dead_exports: findDeadExports,
  find_duplicate_structure: findDuplicateStructure,
  calculate_complexity: calculateComplexity,
  detect_syntax_errors: detectSyntaxErrors,
  sleep: sleep,
  ask_user_question: askUserQuestion,
  lsp: runLsp,
  navigate_symbol: navigateSymbol,
  find_symbol_relationships: findSymbolRelationships,
  inspect_symbol: inspectSymbol,
  diagnostics: diagnostics,
  rename_symbol: renameSymbol,
  code_actions: codeActions,
  format_code: formatCode,
};

for (const definition of TOOL_DEFINITIONS) {
  if (!HANDLERS[definition.name]) throw new Error(`Tool definition has no handler: ${definition.name}`);
}
for (const name of Object.keys(HANDLERS)) {
  if (!TOOL_DEFINITIONS.some(definition => definition.name === name)) throw new Error(`Tool handler has no definition: ${name}`);
}

export async function dispatch(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  return handler(args);
}
