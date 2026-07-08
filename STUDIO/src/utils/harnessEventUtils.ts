/**
 * Pure helpers for Studio Harness execution event display.
 * No React imports — safe to use anywhere.
 */

import type { HarnessEvent } from "../types";

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

const LABEL_MAP: Record<string, [running: string, complete: string]> = {
  edit_file:    ["Editing",   "Edited"],
  write_file:   ["Writing",   "Created"],
  create_file:  ["Creating",  "Created"],
  read_file:    ["Reading",   "Read"],
  bash:         ["Running",   "Ran"],
  powershell:   ["Running",   "Ran"],
  repl:         ["Running",   "Ran"],
  glob:         ["Searching", "Searched"],
  grep:         ["Searching", "Searched"],
  ls:           ["Listing",   "Listed"],
  list_dir:     ["Listing",   "Listed"],
  delete_file:  ["Deleting",  "Deleted"],
  move_file:    ["Moving",    "Moved"],
  copy_file:    ["Copying",   "Copied"],
  mkdir:        ["Creating",  "Created"],
};

export function getHarnessLabel(
  tool: string,
  status: "running" | "complete" | "error"
): string {
  if (status === "error") return "Failed";
  const pair = LABEL_MAP[tool.toLowerCase()];
  if (pair) return status === "running" ? pair[0] : pair[1];
  return status === "running" ? "Running" : "Done";
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

export function getHarnessTarget(
  tool: string,
  args: Record<string, unknown>
): string {
  // File path args (various naming conventions across harness tools)
  const pathVal =
    args.path ?? args.file_path ?? args.target_file ??
    args.destination ?? args.src ?? args.source;
  if (typeof pathVal === "string" && pathVal) return basename(pathVal);

  const t = tool.toLowerCase();

  // Shell commands — show first 3 tokens
  if (t === "bash" || t === "powershell" || t === "repl") {
    const cmd = String(args.command ?? args.cmd ?? args.script ?? "").trim();
    const tokens = cmd.split(/\s+/).slice(0, 3).join(" ");
    return tokens.slice(0, 45) || t;
  }

  // Search / glob tools
  if (typeof args.pattern === "string" && args.pattern) return args.pattern.slice(0, 45);
  if (typeof args.query === "string" && args.query) return args.query.slice(0, 45);

  return tool;
}

// ---------------------------------------------------------------------------
// Diff stats
// ---------------------------------------------------------------------------

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

export function extractDiffStats(
  tool: string,
  args: Record<string, unknown>,
  result: unknown
): { added: number; removed: number } | undefined {
  const t = tool.toLowerCase();
  if (t !== "edit_file" && t !== "write_file" && t !== "create_file") return undefined;

  const r = result as Record<string, unknown> | null | undefined;

  // Explicit diff stats in result
  if (r && typeof r.added === "number" && typeof r.removed === "number") {
    return { added: r.added, removed: r.removed };
  }

  // Unified diff string
  const diffStr = (r?.diff ?? args.diff) as string | undefined;
  if (typeof diffStr === "string" && diffStr) return countDiffLines(diffStr);

  // For write/create: count lines added
  if (t === "write_file" || t === "create_file") {
    const content = String(args.content ?? args.new_content ?? "");
    return { added: content.split("\n").length, removed: 0 };
  }

  // For edit_file: derive from old/new content
  if (t === "edit_file") {
    const oldStr = String(args.old_content ?? args.old_str ?? "");
    const newStr = String(args.new_content ?? args.new_str ?? "");
    if (oldStr || newStr) {
      const oldLines = oldStr ? oldStr.split("\n").length : 0;
      const newLines = newStr ? newStr.split("\n").length : 0;
      return {
        added:   Math.max(0, newLines - Math.min(oldLines, newLines)) + Math.max(0, newLines - oldLines),
        removed: Math.max(0, oldLines - Math.min(oldLines, newLines)) + Math.max(0, oldLines - newLines),
      };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Preview (expanded pane content)
// ---------------------------------------------------------------------------

export function extractHarnessPreview(
  tool: string,
  args: Record<string, unknown>,
  result: unknown
): string | undefined {
  const t = tool.toLowerCase();
  const r = result as Record<string, unknown> | null | undefined;

  // Prefer explicit diff (unified format)
  const diffStr = (r?.diff ?? args.diff) as string | undefined;
  if (typeof diffStr === "string" && diffStr.trim()) return diffStr.slice(0, 3000);

  // Shell output
  if (t === "bash" || t === "powershell" || t === "repl") {
    const out = String(r?.output ?? r?.stdout ?? r?.content ?? r?.result ?? result ?? "").trim();
    return out ? out.slice(0, 1500) : undefined;
  }

  // File reads
  if (t === "read_file") {
    const content = String(r?.content ?? r?.text ?? result ?? "").trim();
    return content ? content.slice(0, 1500) : undefined;
  }

  // Edit: synthesise a minimal diff from old/new strings
  if (t === "edit_file") {
    const oldStr = String(args.old_content ?? args.old_str ?? "").trimEnd();
    const newStr = String(args.new_content ?? args.new_str ?? "").trimEnd();
    if (oldStr || newStr) {
      const removed = oldStr.split("\n").map(l => `- ${l}`).join("\n");
      const added   = newStr.split("\n").map(l => `+ ${l}`).join("\n");
      return `${removed}\n${added}`.slice(0, 3000);
    }
  }

  // Write / create: first N lines of content
  if (t === "write_file" || t === "create_file") {
    const content = String(args.content ?? args.new_content ?? "").trim();
    if (content) {
      return content.split("\n").slice(0, 30).join("\n");
    }
  }

  // Search results
  if (t === "glob" || t === "grep") {
    if (Array.isArray(r?.results)) return (r.results as string[]).slice(0, 30).join("\n");
    if (typeof result === "string") return result.slice(0, 500);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Line range (for read_file)
// ---------------------------------------------------------------------------

export function extractLineRange(
  tool: string,
  args: Record<string, unknown>
): string | undefined {
  if (tool.toLowerCase() !== "read_file") return undefined;
  const start = args.start_line ?? args.offset ?? args.from_line;
  const end   = args.end_line   ?? args.limit   ?? args.to_line;
  if (start !== undefined && end !== undefined) return `${start}–${end}`;
  if (start !== undefined) return `${start}+`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Factory — build a complete HarnessEvent from a completed tool call
// ---------------------------------------------------------------------------

export function buildHarnessEvent(
  callId: string,
  tool:   string,
  args:   Record<string, unknown>,
  status: "running" | "complete" | "error",
  result?: unknown
): HarnessEvent {
  return {
    callId,
    tool,
    args,
    status,
    result,
    label:     getHarnessLabel(tool, status),
    target:    getHarnessTarget(tool, args),
    diffStats: status !== "running" ? extractDiffStats(tool, args, result) : undefined,
    lineRange: extractLineRange(tool, args),
    preview:   status !== "running" ? extractHarnessPreview(tool, args, result) : undefined,
  };
}
