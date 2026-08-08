import { readFile, readManyFiles, fileMetadata, detectBinary, contentHash, watchFiles, editFile, multiEditFile, writeFile, globFiles, grepFiles, listDirectory, deleteFile, moveFile } from "./tools/filesystem/index.js";
import { readNotebook } from "./tools/notebook/index.js";
import { outlineFile } from "./tools/codeintel/index.js";
import { executeBash, executePowerShell, runRepl } from "./tools/execution/index.js";
import {
  gitStatus, gitDiff, gitLog, gitCommit, gitBranch, gitPush, gitPull, gitFetch, gitShow, gitStash, gitWorktree,
  gitInit, gitAdd, gitReset, gitRestore, gitRm, gitMv, gitMerge, gitRebase, gitCherryPick, gitRevert,
  gitTag, gitRemote, gitClone, gitBlame, gitClean, gitReflog, gitConfig, searchGitHistory,
} from "./tools/git/index.js";
import { askUserQuestion } from "./tools/interaction/index.js";
import { sleep } from "./tools/utils/index.js";
import { navigateSymbol, findSymbolRelationships, inspectSymbol, diagnostics, renameSymbol, codeActions, formatCode } from "./tools/lsp/index.js";
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

// ---------------------------------------------------------------------------
// Tool definitions (schema sent to the AI via tools/list)
//
// LAYER 1 ONLY. This is the deliberately-minimal set of primitive tools:
// atomic filesystem / execution / git / code-navigation operations plus
// ask_user_question. Higher-altitude capabilities (exploration, semantic
// retrieval, code-graph, structural analysis, subagent spawning, skills) are
// NOT tools — they belong to layers 2-5 and are built on top of these.
//
// Composed from the per-folder definition arrays. This file only declares the
// ORDER tools are advertised in — to change a tool's schema, edit the
// definitions.ts in its folder, not here.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = finalizeToolDefinitions([
  ...EXECUTION_DEFINITIONS,   // bash, powershell, repl
  ...NETWORK_DEFINITIONS,     // ssh_exec, ssh_session (remote command execution)
  ...FILESYSTEM_DEFINITIONS,  // read/edit/write/delete/move, glob, grep, ls, metadata, hash, watch
  ...NOTEBOOK_DEFINITIONS,    // read_notebook
  ...CODEINTEL_DEFINITIONS,   // outline_file (structural outline primitive)
  ...GIT_DEFINITIONS,         // full git surface: status/diff/log/commit/branch/push/pull/fetch/show/stash/worktree + init/add/reset/restore/rm/mv/merge/rebase/cherry-pick/revert/tag/remote/clone/blame/clean/reflog/config + history search
  ...UTILS_DEFINITIONS,       // sleep
  ...IDE_DEFINITIONS,         // structured LSP navigation, diagnostics, and safe semantic edits
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
  ssh_exec: executeSshCommand,
  ssh_session: manageSshSession,
  read_file: readFile,
  read_many_files: readManyFiles,
  file_metadata: fileMetadata,
  detect_binary: detectBinary,
  content_hash: contentHash,
  watch_files: watchFiles,
  read_notebook: readNotebook,
  edit_file: editFile,
  multi_edit: multiEditFile,
  write_file: writeFile,
  delete_file: deleteFile,
  move_file: moveFile,
  glob: globFiles,
  grep: grepFiles,
  ls: listDirectory,
  outline_file: outlineFile,
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
  sleep: sleep,
  ask_user_question: askUserQuestion,
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
