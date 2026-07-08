import { readFile, editFile, multiEditFile, writeFile, globFiles, grepFiles, listDirectory, deleteFile, moveFile } from "./tools/filesystem/index.js";
import { outlineFile, indexCodebase, exploreCodebase, searchSymbol, analyzeFile } from "./tools/codeintel/index.js";
import { executeBash, executePowerShell, runRepl } from "./tools/execution/index.js";
import {
  gitStatus, gitDiff, gitLog, gitCommit, gitBranch, gitPush, gitPull, gitFetch, gitShow, gitStash, gitWorktree,
  gitInit, gitAdd, gitReset, gitRestore, gitRm, gitMv, gitMerge, gitRebase, gitCherryPick, gitRevert,
  gitTag, gitRemote, gitClone, gitBlame, gitClean, gitReflog, gitConfig,
} from "./tools/git/index.js";
import { askUserQuestion } from "./tools/interaction/index.js";
import { sleep } from "./tools/utils/index.js";
import { runLsp } from "./tools/lsp/index.js";
import { LSP_TOOL_DEFINITION } from "./tools/lsp/definitions.js";
import { executeSshCommand, manageSshSession } from "./tools/network/index.js";

// Tool schema definitions are co-located with their handler folder. Each folder
// owns both its implementation and the JSON schema the AI sees via tools/list.
import { EXECUTION_DEFINITIONS }   from "./tools/execution/definitions.js";
import { NETWORK_DEFINITIONS }     from "./tools/network/definitions.js";
import { FILESYSTEM_DEFINITIONS }  from "./tools/filesystem/definitions.js";
import { CODEINTEL_DEFINITIONS }   from "./tools/codeintel/definitions.js";
import { GIT_DEFINITIONS }         from "./tools/git/definitions.js";
import { UTILS_DEFINITIONS }       from "./tools/utils/definitions.js";
import { INTERACTION_DEFINITIONS } from "./tools/interaction/definitions.js";

// ---------------------------------------------------------------------------
// Tool definitions (schema sent to the AI via tools/list)
//
// Composed from the per-folder definition arrays. This file only declares the
// ORDER tools are advertised in — to change a tool's schema, edit the
// definitions.ts in its folder, not here.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  ...EXECUTION_DEFINITIONS,   // bash, powershell, repl
  ...NETWORK_DEFINITIONS,     // ssh_exec, ssh_session (remote command execution)
  ...FILESYSTEM_DEFINITIONS,  // read/edit/write/delete/move, glob, grep, ls
  ...CODEINTEL_DEFINITIONS,   // outline, index_codebase, explore, search_symbol, analyze
  ...GIT_DEFINITIONS,         // full git surface: status/diff/log/commit/branch/push/pull/fetch/show/stash/worktree + init/add/reset/restore/rm/mv/merge/rebase/cherry-pick/revert/tag/remote/clone/blame/clean/reflog/config
  ...UTILS_DEFINITIONS,       // sleep
  LSP_TOOL_DEFINITION,        // lsp
  ...INTERACTION_DEFINITIONS, // ask_user_question
];

// ---------------------------------------------------------------------------
// Dispatch — maps tool name → handler function
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const HANDLERS: Record<string, ToolHandler> = {
  bash: executeBash,
  powershell: executePowerShell,
  repl: runRepl,
  ssh_exec: executeSshCommand,
  ssh_session: manageSshSession,
  read_file: readFile,
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
  sleep: sleep,
  ask_user_question: askUserQuestion,
  lsp: runLsp,
};

export async function dispatch(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  return handler(args);
}
