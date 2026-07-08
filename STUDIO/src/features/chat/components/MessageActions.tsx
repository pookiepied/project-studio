import { motion } from "framer-motion";
import {
  TrashIcon as Trash,
  PencilSimpleIcon as PencilSimple,
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowRightIcon as ArrowRight,
  DotsThreeIcon as DotsThree,
  SpeakerHighIcon as SpeakerHigh,
  StopIcon as Stop,
  BrainIcon as Brain,
  MagnifyingGlassIcon as MagnifyingGlass,
  GlobeIcon as Globe,
  ArrowsClockwiseIcon as ArrowsClockwise,
  DatabaseIcon as Database,
  BookOpenIcon as BookOpen,
  CheckSquareIcon as CheckSquare,
  RobotIcon as Robot,
  ImageSquareIcon as ImageSquare,
  FilmStripIcon as FilmStrip,
  CloudIcon as Cloud,
  MapPinIcon as MapPin,
  FileMagnifyingGlassIcon as FileMagnifyingGlass,
  ArrowsOutIcon as ArrowsOut,
  TerminalIcon as Terminal,
  PlugIcon as Plug,
  WrenchIcon as Wrench,
  CheckIcon as Check,
  CopyIcon as Copy,
} from "@phosphor-icons/react";
import type { ChatMessage } from "@/types";

// ── Tool icon helper (size-10, used in the "tools used" popup) ──────────────

function getToolIcon(tool: string) {
  if (tool.startsWith("mcp_"))    return <Plug size={10} weight="bold" />;
  if (tool.startsWith("memory_")) return <Database size={10} weight="bold" />;
  switch (tool) {
    case "think":          return <Brain size={10} weight="bold" />;
    case "web_search":     return <MagnifyingGlass size={10} weight="bold" />;
    case "web_fetch":      return <Globe size={10} weight="bold" />;
    case "http_request":   return <ArrowsClockwise size={10} weight="bold" />;
    case "skill_read":     return <BookOpen size={10} weight="bold" />;
    case "task_write":     return <CheckSquare size={10} weight="bold" />;
    case "spawn_agent":    return <Robot size={10} weight="bold" />;
    case "image_generate": return <ImageSquare size={10} weight="bold" />;
    case "video_generate": return <FilmStrip size={10} weight="bold" />;
    case "video_status":   return <FilmStrip size={10} weight="bold" />;
    case "weather":        return <Cloud size={10} weight="bold" />;
    case "get_location":   return <MapPin size={10} weight="bold" />;
    case "rag":            return <FileMagnifyingGlass size={10} weight="bold" />;
    case "expand_tools":   return <ArrowsOut size={10} weight="bold" />;
    case "claude_code":    return <Terminal size={10} weight="bold" />;
    default:               return <Wrench size={10} weight="bold" />;
  }
}

function formatToolName(tool: string) {
  return tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ────────────────────────────────────────────────────────────────

interface MessageActionsProps {
  message:            ChatMessage;
  isLoading:          boolean;
  isLastAssistant:    boolean;
  copiedMessageId:    string | null;
  ttsPlayingId:       string | null;
  ttsLoadingId:       string | null;
  ttsMenuId:          string | null;
  toolsPopupId:       string | null;
  toolCalls:          string[] | null;
  onCopy:             (content: string, id: string) => void;
  onEdit:             (id: string, content: string) => void;
  onDelete:           (id: string) => void;
  onSpeak:            (id: string, content: string) => void;
  onSetTtsMenuId:     (id: string | null) => void;
  onSetToolsPopupId:  (id: string | null) => void;
  onRegenerate:       () => void;
  onContinue:         () => void;
}

export const MessageActions = ({
  message,
  isLoading,
  isLastAssistant,
  copiedMessageId,
  ttsPlayingId,
  ttsLoadingId,
  ttsMenuId,
  toolsPopupId,
  toolCalls,
  onCopy,
  onEdit,
  onDelete,
  onSpeak,
  onSetTtsMenuId,
  onSetToolsPopupId,
  onRegenerate,
  onContinue,
}: MessageActionsProps) => {
  // Keep the bar visible (even without hover) whenever it owns live state the
  // user needs to reach: read-aloud playing/loading, or an open menu/popup.
  // Otherwise moving the cursor off the message would fade out the Stop button
  // or the menu the user is trying to click.
  const forceVisible =
    ttsPlayingId === message.id ||
    ttsLoadingId === message.id ||
    ttsMenuId === message.id ||
    toolsPopupId === message.id;

  return (
  <motion.div
    initial={{ opacity: 0 }}
    whileHover={{ opacity: 1 }}
    className={`absolute top-[calc(100%-8px)] pt-2.5 pb-1 flex items-center gap-0.5 transition-opacity duration-150 z-10 ${
      isLoading
        ? "opacity-0 pointer-events-none"
        : forceVisible
          ? "opacity-100 pointer-events-auto"
          : "opacity-100 md:opacity-0 md:group-hover:opacity-100 pointer-events-auto md:pointer-events-none md:group-hover:pointer-events-auto"
    } ${message.role === "user" ? "right-0" : "left-0"}`}
  >
    {/* Copy */}
    <button
      onClick={() => onCopy(message.content, message.id)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Copy"
    >
      {copiedMessageId === message.id
        ? <Check       size={13} weight="bold" className="text-secondary" />
        : <Copy        size={13} weight="bold" className="text-gray-400 dark:text-gray-600" />}
    </button>

    {/* Edit */}
    <button
      onClick={() => onEdit(message.id, message.content)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Edit"
    >
      <PencilSimple size={13} weight="bold" className="text-gray-400 dark:text-gray-600" />
    </button>

    {/* Delete */}
    <button
      onClick={() => onDelete(message.id)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Delete"
    >
      <Trash size={13} weight="bold" className="text-gray-400 dark:text-gray-600" />
    </button>

    {/* Read aloud — assistant only */}
    {message.role === "assistant" && (
      <button
        onClick={() => onSpeak(message.id, message.content)}
        className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
        title={ttsPlayingId === message.id ? "Stop" : "Read aloud"}
      >
        {ttsLoadingId === message.id ? (
          <span className="w-3 h-3 border border-gray-400 dark:border-gray-600 border-t-transparent rounded-full animate-spin block flex-shrink-0" />
        ) : ttsPlayingId === message.id ? (
          <Stop        size={13} weight="fill"  className="text-gray-500 dark:text-gray-500" />
        ) : (
          <SpeakerHigh size={13} weight="bold"  className="text-gray-400 dark:text-gray-600" />
        )}
      </button>
    )}

    {/* Tools used popup — assistant + has tool calls */}
    {message.role === "assistant" && toolCalls?.length ? (
      <div className="relative flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); onSetToolsPopupId(toolsPopupId === message.id ? null : message.id); }}
          className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
          title="Tools used"
        >
          <Wrench size={13} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </button>
        {toolsPopupId === message.id && (
          <div className="absolute bottom-full right-0 mb-1 bg-white dark:bg-surface-raised border border-gray-100 dark:border-surface-border rounded-lg shadow-lg py-2.5 px-3 min-w-[160px] z-50">
            <p className="text-2xs font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">
              {toolCalls.length} tool{toolCalls.length !== 1 ? "s" : ""} used
            </p>
            <div className="flex flex-wrap gap-1">
              {toolCalls.map((tool, i) => (
                <span
                  key={tool + i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-gray-100 dark:bg-surface-border text-gray-600 dark:text-gray-400"
                >
                  {getToolIcon(tool)}
                  {formatToolName(tool)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null}

    {/* More actions (Regenerate / Continue) — assistant only */}
    {message.role === "assistant" && (
      <div className="relative flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); onSetTtsMenuId(ttsMenuId === message.id ? null : message.id); }}
          aria-expanded={ttsMenuId === message.id}
          aria-haspopup="menu"
          className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
          title="More actions"
        >
          <DotsThree size={13} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </button>
        {ttsMenuId === message.id && (
          <div role="menu" className="absolute bottom-full right-0 mb-1 bg-white dark:bg-surface-raised border border-gray-100 dark:border-surface-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
            {isLastAssistant ? (
              <>
                <button role="menuitem" onClick={() => { onRegenerate(); onSetTtsMenuId(null); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border transition-colors"
                >
                  <ArrowClockwise size={13} weight="bold" className="flex-shrink-0" />
                  Regenerate
                </button>
                <button role="menuitem" onClick={() => { onContinue(); onSetTtsMenuId(null); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border transition-colors"
                >
                  <ArrowRight size={13} weight="bold" className="flex-shrink-0" />
                  Continue
                </button>
              </>
            ) : (
              <p className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-600 italic">No actions</p>
            )}
          </div>
        )}
      </div>
    )}
  </motion.div>
  );
};
