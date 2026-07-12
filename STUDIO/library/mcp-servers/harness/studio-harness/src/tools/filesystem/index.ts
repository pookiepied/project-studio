/**
 * Filesystem tools — export boundary.
 *
 * Raw file access + search: read, write, edit, delete, move, ls, glob, grep.
 * Higher-order code comprehension (outline, indexing, symbol search, analysis)
 * lives in ../codeintel.
 *
 * Pure-JS tools (read, write, edit, glob, ls, delete, move) are wrapped with
 * wrapTool() here — any unhandled exception becomes { error } instead of
 * crashing the MCP server. The process-based grep tool manages its own timeout
 * + error contract internally and is re-exported directly.
 */
import { wrapTool } from "../tool-contract.js";

// ── Pure-JS tools — wrapped at the export boundary ──────────────────────────

import { readFile as _readFile }               from "./read.js";
import { readManyFiles as _readManyFiles }     from "./read-many.js";
import { fileMetadata as _fileMetadata, detectBinary as _detectBinary, contentHash as _contentHash } from "./inspect.js";
import { watchFiles as _watchFiles }           from "./watch.js";
import { editFile as _editFile }               from "./edit.js";
import { multiEditFile as _multiEditFile }     from "./multi-edit.js";
import { writeFile as _writeFile }             from "./write.js";
import { globFiles as _globFiles }             from "./glob.js";
import { listDirectory as _listDirectory }     from "./ls.js";
import { deleteFile as _deleteFile }           from "./delete.js";
import { moveFile as _moveFile }               from "./move.js";

export const readFile      = wrapTool("read_file",       _readFile);
export const readManyFiles = wrapTool("read_many_files", _readManyFiles);
export const fileMetadata  = wrapTool("file_metadata",   _fileMetadata);
export const detectBinary  = wrapTool("detect_binary",   _detectBinary);
export const contentHash   = wrapTool("content_hash",    _contentHash);
export const watchFiles    = wrapTool("watch_files",     _watchFiles);
export const editFile      = wrapTool("edit_file",       _editFile);
export const multiEditFile = wrapTool("multi_edit",      _multiEditFile);
export const writeFile     = wrapTool("write_file",      _writeFile);
export const globFiles     = wrapTool("glob",            _globFiles);
export const listDirectory = wrapTool("ls",              _listDirectory);
export const deleteFile    = wrapTool("delete_file",     _deleteFile);
export const moveFile      = wrapTool("move_file",       _moveFile);

// ── Process-based tool — re-exported directly ───────────────────────────────
// grep spawns ripgrep and handles its own timeout + error contract.

export { grepFiles }                                    from "./grep.js";
