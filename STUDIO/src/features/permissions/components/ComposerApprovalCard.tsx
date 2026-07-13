import { useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { toolLabel, getToolIcon } from "@/runtime";
import { RISK_CLASS_META, extractTargetPaths } from "@/core/permissions";
import type { GrantScope } from "@/core/permissions";
import type { ActiveToolCall } from "@/features/chat/context/types";
import type { ToolApprovalDecision } from "@/features/chat/context/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ComposerApprovalCardProps {
  /** The single tool call awaiting user approval (`status === "pending_approval"`). */
  toolCall: ActiveToolCall | null;
  /** Resolve the prompt - receives a grant scope or `"deny"`. */
  onDecision: (decision: ToolApprovalDecision) => void;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<GrantScope, string> = {
  once:      "Allow once",
  session:   "Allow for this chat",
  workspace: "Always allow here",
  global:    "Always allow",
};

/** True for filesystem-handling tools - surfaces the targeted file/directory. */
function isFilesystemTool(tool: string): boolean {
  switch (tool) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "multi_edit":
    case "delete_file":
    case "move_file":
    case "glob":
    case "grep":
    case "ls":
      return true;
    default:
      return false;
  }
}

/** Last segment of a normalised path, for a friendly preview. */
function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function buildSummary(tool: string, args: Record<string, unknown>): string {
  if (tool === "bash" || tool === "powershell") {
    const cmd = args.command as string | undefined;
    return cmd ? (cmd.length > 160 ? cmd.slice(0, 160) + "..." : cmd) : "";
  }
  if (isFilesystemTool(tool)) {
    // Studio Harness uses several path-argument names; pull the first one found.
    const path =
      (args.path as string) ??
      (args.file_path as string) ??
      (args.source as string) ??
      (args.destination as string) ??
      (args.dir as string) ??
      (args.root_dir as string) ??
      (args.cwd as string);
    return typeof path === "string" && path ? path : "";
  }
  if (tool === "repl") {
    const lang = args.language as string | undefined;
    const code = args.code as string | undefined;
    const preview = code ? (code.length > 100 ? code.slice(0, 100) + "..." : code) : "";
    return lang ? `[${lang}] ${preview}` : preview;
  }
  // Generic fallback: show the first string-valued argument as context.
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v.length > 0) {
      return v.length > 140 ? v.slice(0, 140) + "..." : v;
    }
  }
  return "";
}

function buildActionPhrase(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "powershell") return "run a shell command";
  if (t === "edit_file" || t === "multi_edit") return "edit a file";
  if (t === "write_file") return "write a file";
  if (t === "delete_file") return "delete a file";
  if (t === "move_file") return "move a file";
  if (t === "repl") return "execute code";
  if (t === "git_commit" || t === "git_push" || t === "git_branch") return "change git state";
  if (t.startsWith("git_")) return "run a git command";
  return `use ${toolLabel(tool)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Composer-positioned approval card - the primary review-mode prompt surface.
 *
 * Slides in just above the chat input when a tool call enters
 * `pending_approval`, exposing: the tool label, an action phrase, a summary of
 * the targeted arguments (file path / shell command), the risk class, the
 * engine-supplied reason, and one button per offered grant scope plus a Deny.
 *
 * Visibility is driven by the parent (`ChatPage` passes the first
 * `pending_approval` tool call from `activeToolCalls`). It renders nothing
 * when there is no pending approval to surface.
 *
 * The card does NOT manage its own pending state - the ChatProvider owns the
 * promise resolver and only re-renders the card while the decision remains
 * open. That keeps the prompt durable across page navigation: switching to
 * Settings unmounts the visual card, but the promise keeps waiting, and the
 * card slides back in the moment the user returns to chat view. Meanwhile an
 * OS notification (Tauri plugin-notification) handles the "app minimised /
 * system tray" case via {@link usePermissionNotifications}.
 */
export function ComposerApprovalCard({ toolCall, onDecision }: ComposerApprovalCardProps) {
  // Focus the first action button for keyboard accessibility.
  const allowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (toolCall) {
      const t = setTimeout(() => allowRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [toolCall]);

  const summary = useMemo(() => {
    if (!toolCall) return "";
    return buildSummary(toolCall.tool, toolCall.args ?? {});
  }, [toolCall]);

  const filePreview = useMemo(() => {
    if (!toolCall) return "";
    if (!isFilesystemTool(toolCall.tool)) return "";
    const paths = extractTargetPaths(toolCall.tool, toolCall.args ?? {});
    return paths.length > 0 ? paths[0] : "";
  }, [toolCall]);

  // ... rest computed in render
  if (!toolCall) return null;

  const label = toolLabel(toolCall.tool);
  const icon = getToolIcon(toolCall.tool, "sm");
  const riskClass = toolCall.riskClass;
  const riskMeta = riskClass ? RISK_CLASS_META[riskClass] : undefined;
  const riskLabel = riskMeta?.label;
  const action = buildActionPhrase(toolCall.tool);
  const scopes =
    toolCall.offeredScopes && toolCall.offeredScopes.length > 0
      ? toolCall.offeredScopes
      : (["once"] as GrantScope[]);
  const reason = toolCall.approvalReason;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={toolCall.callId}
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-gray-200 dark:border-surface-border bg-white dark:bg-surface-base overflow-hidden shadow-sm transition-colors"
      >
        {/* Header strip */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5">
          <div className="w-5 h-5 rounded-md bg-gray-100 dark:bg-surface-selected border border-gray-200 dark:border-surface-border flex items-center justify-center flex-shrink-0">
            <Lock size="xs" weight="fill" className="text-gray-400 dark:text-gray-500" />
          </div>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
            Permission required
          </span>
          {riskLabel && (
            <span className="ml-auto text-2xs font-medium px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-surface-selected text-gray-500 dark:text-gray-400">
              {riskLabel}
            </span>
          )}
        </div>

        <div className="h-px bg-gray-100 dark:bg-surface-divider" />

        {/* Body */}
        <div className="px-3.5 py-3 space-y-2.5">
          {/* Tool + action phrase */}
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0">{icon}</span>
            <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{label}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                - AI wants to {action}
              </span>
            </div>
          </div>

          {/* Target preview - file path / shell command / code snippet */}
          {summary && (
            <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all bg-gray-50 dark:bg-surface-deep rounded-lg px-3 py-2 border border-gray-100 dark:border-surface-selected leading-relaxed max-h-[80px] overflow-y-auto">
              {filePreview && filePreview.length > 0 ? (
                <>
                  <span className="text-gray-400 dark:text-gray-600">{basename(filePreview) === filePreview ? "" : `${filePreview.length > 100 ? filePreview.slice(0, 100) + "..." : filePreview}\n`}</span>
                  {summary}
                </>
              ) : (
                summary
              )}
            </pre>
          )}

          {/* Reason from the engine */}
          {reason && (
            <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">{reason}</p>
          )}

          {/* Action buttons - first button (broadest always) is the focused/primary */}
          <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
            {scopes.map((scope, i) => (
              <Button
                key={scope}
                ref={i === 0 ? allowRef : undefined}
                variant={i === 0 ? "primary" : "ghost"}
                onClick={() => onDecision(scope)}
                className={
                  i === 0
                    ? "px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
                    : "px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-surface-border text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-selected active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-1"
                }
              >
                {SCOPE_LABELS[scope]}
              </Button>
            ))}
            <Button
              variant="ghost"
              onClick={() => onDecision("deny")}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-surface-selected hover:text-secondary dark:hover:text-secondary active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-1"
            >
              Deny
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
