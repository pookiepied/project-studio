import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAutoResizeTextarea } from "@/lib/hooks/useAutoResizeTextarea";
import { useNavigation } from "@/app/contexts/NavigationContext";
import {
  Add,
  Files,
  Icon,
  TargetIcon,
  Checklist,
  Grid,
  Eye,
  Brain,
  Stop,
  Send,
} from "@/ui/icons";
import { FEATURED_APPS } from "@/features/extensions/components/ComposioCards";
import { AppLogo } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Spinner } from "@/ui/primitives/Spinner";
import { Textarea } from "@/ui/primitives/Textarea";
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
  const isPreparingResponse = isLoading && !isStreaming;

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
      className="relative flex flex-col bg-surface-page dark:bg-surface-base border border-surface-border rounded-xl shadow-md focus-within:border-surface-border focus-within:shadow-lg transition-all duration-200"
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-surface-page/85 dark:bg-surface-base/85 border-2 border-dashed border-surface-border dark:border-surface-border pointer-events-none"
          >
            <span className="text-sm font-medium text-muted dark:text-disabled">
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

      <Textarea
        ref={inputRef}
        value={inputMessage}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        placeholder="Do anything..."
        className="min-h-[54px] resize-none border-0 bg-transparent px-3.5 pb-2 pt-3.5 text-sm font-normal leading-[18px] text-primary placeholder:text-disabled scrollbar-thin focus-visible:ring-0 disabled:cursor-not-allowed"
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
                  ? "bg-surface-base dark:bg-surface-border text-secondary dark:text-disabled"
                  : "text-disabled dark:text-secondary hover:bg-surface-base dark:hover:bg-surface-border hover:text-secondary dark:hover:text-disabled",
              )}
            >
              <Add size="sm" />
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
                  className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-surface-border bg-surface-base shadow-lg backdrop-blur-xl"
                >
                  <div className="max-h-[316px] overflow-y-auto px-1.5 py-2 scrollbar-thin">
                    <div className="px-2 pb-1 text-sm leading-none text-disabled dark:text-muted">
                      Add
                    </div>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { onTriggerFileInput(); onToggleAttachMenu(); }}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-secondary transition-colors hover:bg-surface-base/80 dark:text-disabled dark:hover:bg-surface-selected"
                    >
                      <Files size="sm" className="shrink-0 text-muted dark:text-disabled" />
                      <span className="min-w-0 flex-1 truncate">Files and folders</span>
                    </Button>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-muted transition-colors hover:bg-surface-base/70 dark:text-disabled dark:hover:bg-surface-selected"
                    >
                      <Icon icon={TargetIcon} size="sm" className="shrink-0 text-muted dark:text-muted" />
                      <span className="shrink-0 text-secondary dark:text-disabled">Goal</span>
                      <span className="min-w-0 flex-1 truncate text-disabled dark:text-secondary">
                        Set a goal that Studio will keep working towards
                      </span>
                    </Button>

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-muted transition-colors hover:bg-surface-base/70 dark:text-disabled dark:hover:bg-surface-selected"
                    >
                      <Checklist size="sm" className="shrink-0 text-muted dark:text-muted" />
                      <span className="shrink-0 text-secondary dark:text-disabled">Plan mode</span>
                      <span className="min-w-0 flex-1 truncate text-disabled dark:text-secondary">
                        Turn plan mode on
                      </span>
                    </Button>

                    <div className="px-2 pb-1 pt-3 text-sm leading-none text-disabled dark:text-muted">
                      Apps
                    </div>

                    {addMenuApps.map((app) => (
                      <Button
                        key={app.id}
                        variant="ghost"
                        role="menuitem"
                        tabIndex={-1}
                        className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-secondary transition-colors hover:bg-surface-base/80 dark:text-disabled dark:hover:bg-surface-selected"
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
                        <span className="min-w-0 flex-1 truncate text-disabled dark:text-secondary">
                          {app.description}
                        </span>
                      </Button>
                    ))}

                    <Button
                      variant="ghost"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { navigateTo("extensions"); onToggleAttachMenu(); }}
                      className="group flex h-auto w-full items-center gap-2 justify-start rounded-lg px-2 text-left text-sm leading-none text-muted transition-colors hover:bg-surface-base/70 dark:text-disabled dark:hover:bg-surface-selected"
                    >
                      <Grid size="sm" className="shrink-0 text-muted dark:text-muted" />
                      <span className="shrink-0 text-secondary dark:text-disabled">More apps</span>
                      <span className="min-w-0 flex-1 truncate text-disabled dark:text-secondary">
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
                      ? "bg-surface-base dark:bg-surface-selected text-secondary dark:text-disabled hover:bg-surface-raised dark:hover:bg-surface-border"
                      : "text-disabled dark:text-secondary hover:bg-surface-base dark:hover:bg-surface-border hover:text-secondary dark:hover:text-disabled",
                  )}
                >
                  {autonomous
? <Brain size="xs" weight="fill" />
            : <Eye size="xs" />}
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
            {isPreparingResponse ? (
              <IconButton
                aria-label="Preparing response"
                title="Preparing response"
                onClick={onAbort}
                className={cx(
                  composerRoundIconButton,
                  "bg-surface-base dark:bg-surface-border text-secondary dark:text-disabled hover:bg-surface-raised dark:hover:bg-surface-active",
                )}
              >
                <Spinner size="sm" decorative />
              </IconButton>
            ) : isStreaming ? (
              <IconButton
                aria-label="Stop generation"
                title="Stop generation"
                onClick={onAbort}
                className={cx(
                  composerRoundIconButton,
                  "bg-surface-base dark:bg-surface-border text-secondary dark:text-disabled hover:bg-surface-raised dark:hover:bg-surface-active",
                )}
              >
                <Stop size="sm" weight="fill" />
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
                    ? "bg-primary text-on-emphasis shadow-sm hover:bg-secondary dark:bg-secondary dark:text-primary dark:hover:bg-primary"
                    : "bg-surface-base text-disabled cursor-not-allowed dark:bg-surface-selected dark:text-secondary",
                )}
              >
                <Send size="sm" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
