import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAutoResizeTextarea } from "@/lib/hooks/useAutoResizeTextarea";
import { useNavigation } from "@/app/contexts/NavigationContext";
import {
  PlusIcon as Plus,
  FilesIcon as Files,
  TargetIcon as Target,
  ListChecksIcon as ListChecks,
  SquaresFourIcon as SquaresFour,
  EyeIcon as Eye,
  BrainIcon as Brain,
  StopIcon as Stop,
  ArrowUpIcon as ArrowUp,
} from "@phosphor-icons/react";
import { FEATURED_APPS } from "@/features/extensions/components/ComposioCards";
import { AppLogo } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { useComposioLogos } from "@/features/extensions/hooks/useComposioLogos";
import { TierSelector } from "@/features/models/components/TierSelector";
import { VoiceInput } from "@/features/voice/components/VoiceInput";
import { AttachmentInput } from "@/features/chat/components/AttachmentInput";
import { EngineSelector } from "./EngineSelector";
import { PermissionModeSelector } from "./PermissionModeSelector";
import { ClaudeModelSelector } from "./ClaudeModelSelector";
import {
  composerPillLabel,
  composerPillButton,
  composerRoundIconButton,
  composerToolbarGroup,
  cx,
} from "./composerControlStyles";
import type { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import type { RecentFileEntry } from "@/app/hooks/useRecentFiles";
import type { AppSettings } from "@/types";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import type { PermissionModeId } from "@/core/permissions";

interface ChatComposerProps {
  inputMessage: string;
  attachments: FileAttachment[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  attachMenuRef: React.RefObject<HTMLDivElement | null>;
  showAttachMenu: boolean;
  isLoading: boolean;
  isStreaming: boolean;
  currentModel: string;
  engineLocked?: boolean;
  availableEngines?: readonly ChatEngine[];
  chatEngine: ChatEngine;
  claudeModel: string;
  claudePermissionMode: PermissionModeId;
  claudeEffortLevel: ClaudeEffortLevel;
  customModelName: string | undefined;
  modelsLoading: boolean;
  reasoningBudget: number | undefined;
  settings: AppSettings;
  projectContext: { path: string; name: string; accessMode?: "review" | "autonomous" } | null;
  recentFiles: RecentFileEntry[];
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onAbort: () => void;
  onToggleAttachMenu: () => void;
  onTriggerFileInput: () => void;
  onSelectRecentFile: (entry: RecentFileEntry) => void | Promise<void>;
  onAttachmentsChange: (attachments: FileAttachment[]) => void;
  onToggleAutopilot: () => void;
  onChatEngineChange: (engine: ChatEngine) => void;
  onSelectModel: (id: string) => void;
  onClaudeModelChange: (id: string) => void;
  onClaudePermissionModeChange: (mode: PermissionModeId) => void;
  onClaudeEffortLevelChange: (level: ClaudeEffortLevel) => void;
  onOpenLibrary: () => void;
  onTranscript: (text: string) => void;
  onReasoningChange: (budget: number | undefined) => void;
  onAddFiles: (files: File[]) => void;
}

export const ChatComposer = ({
  inputMessage,
  attachments,
  inputRef,
  attachMenuRef,
  showAttachMenu,
  isLoading,
  isStreaming,
  currentModel,
  engineLocked = false,
  availableEngines,
  chatEngine,
  claudeModel,
  claudePermissionMode,
  claudeEffortLevel,
  customModelName,
  modelsLoading,
  reasoningBudget,
  settings,
  projectContext,
  onInputChange,
  onKeyDown,
  onSend,
  onAbort,
  onToggleAttachMenu,
  onTriggerFileInput,
  onAttachmentsChange,
  onToggleAutopilot,
  onChatEngineChange,
  onSelectModel,
  onClaudeModelChange,
  onClaudePermissionModeChange,
  onClaudeEffortLevelChange,
  onOpenLibrary,
  onTranscript,
  onReasoningChange,
  onAddFiles,
}: ChatComposerProps) => {
  useAutoResizeTextarea(inputRef, inputMessage, 160);
  const { navigateTo } = useNavigation();
  const [isDragging, setIsDragging] = useState(false);
  const isClaude = chatEngine === "claude";
  const addMenuApps = FEATURED_APPS.slice(0, 6);
  const composioLogos = useComposioLogos();

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.type.startsWith("image/")) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      onAddFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) onAddFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className="relative flex flex-col bg-white dark:bg-surface-base border border-gray-200/80 dark:border-surface-border rounded-xl shadow-[0_10px_34px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_36px_-12px_rgba(0,0,0,0.55)] focus-within:border-gray-300 dark:focus-within:border-surface-border focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.04),0_10px_34px_-12px_rgba(0,0,0,0.20)] dark:focus-within:shadow-[0_0_0_3px_rgba(255,255,255,0.03),0_12px_36px_-12px_rgba(0,0,0,0.6)] transition-all duration-200"
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-white/85 dark:bg-surface-base/85 border-2 border-dashed border-gray-400 dark:border-gray-500 pointer-events-none"
          >
            <span className="text-sm font-medium text-gray-500 dark:text-gray-300">
              Drop images or files to attach
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="px-3.5 pt-2.5"
          >
            <AttachmentInput
              attachments={attachments}
              onAttachmentsChange={onAttachmentsChange}
              disabled={isLoading}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        ref={inputRef}
        value={inputMessage}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        placeholder="Do anything..."
        className="w-full min-h-[54px] resize-none bg-transparent px-3.5 pb-2 pt-3.5 text-sm font-normal leading-[18px] text-gray-900 placeholder-gray-300 scrollbar-thin focus:outline-none disabled:cursor-not-allowed dark:text-gray-100 dark:placeholder-gray-600"
        rows={1}
        disabled={isLoading}
      />

      <div className="flex min-w-0 items-center justify-between gap-3 px-2.5 pb-2.5 pt-0.5">
        <div className={cx(composerToolbarGroup, "min-w-0 flex-1")}>
          <div className="flex-shrink-0" ref={attachMenuRef}>
            <IconButton
              aria-label="Add files or folder"
              onClick={onToggleAttachMenu}
              aria-expanded={showAttachMenu}
              aria-haspopup="menu"
              title="Add files or folder"
              className={cx(
                composerRoundIconButton,
                showAttachMenu
                  ? "bg-gray-100 dark:bg-surface-border text-gray-600 dark:text-gray-300"
                  : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-border hover:text-gray-600 dark:hover:text-gray-400",
              )}
            >
              <Plus size={14} weight="regular" />
            </IconButton>

            <AnimatePresence>
              {showAttachMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  role="menu"
                  style={{ transformOrigin: "bottom left" }}
                  className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-surface-border bg-surface-base shadow-[0_18px_60px_-24px_rgba(0,0,0,0.28),0_8px_20px_-16px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:shadow-[0_18px_60px_-24px_rgba(0,0,0,0.75)]"
                >
                  <div className="max-h-[316px] overflow-y-auto px-1.5 py-2 scrollbar-thin">
                    <div className="px-2 pb-1 text-sm leading-none text-gray-400 dark:text-gray-500">
                      Add
                    </div>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { onTriggerFileInput(); onToggleAttachMenu(); }}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-gray-700 transition-colors hover:bg-gray-100/80 dark:text-gray-200 dark:hover:bg-surface-selected"
                    >
                      <Files size={14} weight="regular" className="shrink-0 text-gray-500 dark:text-gray-400" />
                      <span className="min-w-0 flex-1 truncate">Files and folders</span>
                    </Button>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-gray-500 transition-colors hover:bg-gray-100/70 dark:text-gray-400 dark:hover:bg-surface-selected"
                    >
                      <Target size={14} weight="regular" className="shrink-0 text-gray-500 dark:text-gray-500" />
                      <span className="shrink-0 text-gray-700 dark:text-gray-300">Goal</span>
                      <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-600">
                        Set a goal that Studio will keep working towards
                      </span>
                    </Button>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-gray-500 transition-colors hover:bg-gray-100/70 dark:text-gray-400 dark:hover:bg-surface-selected"
                    >
                      <ListChecks size={14} weight="regular" className="shrink-0 text-gray-500 dark:text-gray-500" />
                      <span className="shrink-0 text-gray-700 dark:text-gray-300">Plan mode</span>
                      <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-600">
                        Turn plan mode on
                      </span>
                    </Button>

                    <div className="px-2 pb-1 pt-3 text-sm leading-none text-gray-400 dark:text-gray-500">
                      Apps
                    </div>

                    {addMenuApps.map((app) => (
                      <Button
                        key={app.id}
                        variant="ghost"
                        role="menuitem"
                        tabIndex={-1}
                        className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-gray-700 transition-colors hover:bg-gray-100/80 dark:text-gray-200 dark:hover:bg-surface-selected"
                      >
                        <AppLogo
                          src={composioLogos.get(app.id)}
                          label={app.name}
                          size="xs"
                          className="rounded-sm"
                          iconBg={app.iconBg}
                          iconColor={app.iconColor}
                          fallback={app.iconNode ?? app.iconLetter ?? app.name.charAt(0)}
                        />
                        <span className="shrink-0">{app.name}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-600">
                          {app.description}
                        </span>
                      </Button>
                    ))}

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { navigateTo("extensions"); onToggleAttachMenu(); }}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-gray-500 transition-colors hover:bg-gray-100/70 dark:text-gray-400 dark:hover:bg-surface-selected"
                    >
                      <SquaresFour size={14} weight="regular" className="shrink-0 text-gray-500 dark:text-gray-500" />
                      <span className="shrink-0 text-gray-700 dark:text-gray-300">More apps</span>
                      <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-600">
                        Browse connected tools and extensions
                      </span>
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <EngineSelector
            value={chatEngine}
            disabled={isLoading || engineLocked}
            availableEngines={availableEngines}
            onChange={onChatEngineChange}
          />

          {isClaude ? (
            <PermissionModeSelector
              engine="claude"
              value={claudePermissionMode}
              disabled={isLoading}
              onChange={onClaudePermissionModeChange}
            />
          ) : !engineLocked ? (
            // Review/Autonomous applies to local chats (project *and* global).
            // The label reflects the EFFECTIVE action mode the permission engine
            // uses: a project's per-folder accessMode when a project is open,
            // otherwise the global autopilot default. Reading the effective mode
            // (not raw autopilotMode) keeps the pill honest in global chats.
            (() => {
              const autonomous = projectContext
                ? projectContext.accessMode === "autonomous"
                : settings.autopilotMode;
              return (
                <Button
                  variant="ghost"
                  onClick={onToggleAutopilot}
                  title={
                    (isStreaming || isLoading
                      ? "Change applies to your next message (the running turn keeps its mode). "
                      : "") +
                    (autonomous
                      ? "Autonomous - AI executes actions automatically"
                      : "Review - AI asks before sensitive actions")
                  }
                  className={cx(
                    composerPillButton,
                    autonomous
                      ? "bg-gray-100 dark:bg-surface-selected text-gray-600 dark:text-gray-300 hover:bg-gray-150 dark:hover:bg-surface-border"
                      : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-border hover:text-gray-600 dark:hover:text-gray-400",
                  )}
                >
                  {autonomous
                    ? <Brain size={12} weight="fill" />
                    : <Eye size={12} weight="regular" />}
                  <span className={composerPillLabel}>{autonomous ? "Autonomous" : "Review"}</span>
                </Button>
              );
            })()
          ) : null}
        </div>

        <div className={cx(composerToolbarGroup, "ml-auto shrink-0 justify-end")}>
          {isClaude ? (
            <ClaudeModelSelector
              model={claudeModel}
              effort={claudeEffortLevel}
              disabled={isLoading}
              onModelChange={onClaudeModelChange}
              onEffortChange={onClaudeEffortLevelChange}
            />
          ) : (
            <TierSelector
              value={currentModel}
              onChange={onSelectModel}
              disabled={modelsLoading || isLoading}
              onOpenLibrary={onOpenLibrary}
              customModelName={customModelName}
              dropUp
              reasoning={reasoningBudget}
              onReasoningChange={onReasoningChange}
            />
          )}

          <VoiceInput
            onTranscript={(text) => onTranscript(text)}
            disabled={isLoading}
          />

          <div className="relative flex-shrink-0">
            {isStreaming || isLoading ? (
              <IconButton
                aria-label="Stop generation"
                title="Stop generation"
                onClick={onAbort}
                className={cx(
                  composerRoundIconButton,
                  "bg-gray-100 dark:bg-surface-border text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-surface-active",
                )}
              >
                <Stop size={14} weight="fill" />
              </IconButton>
            ) : (
              <IconButton
                aria-label="Send message"
                title="Send (Enter)"
                onClick={onSend}
                disabled={!inputMessage.trim() && attachments.length === 0}
                className={cx(
                  composerRoundIconButton,
                  inputMessage.trim() || attachments.length > 0
                    ? "bg-gray-400 text-white shadow-sm hover:bg-gray-500 dark:bg-gray-500 dark:text-gray-100 dark:hover:bg-gray-400"
                    : "bg-gray-100 text-gray-300 cursor-not-allowed dark:bg-surface-selected dark:text-gray-700",
                )}
              >
                <ArrowUp size={14} weight="bold" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
