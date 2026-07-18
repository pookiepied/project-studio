import type { ComponentProps } from "react";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ChatEngine } from "@/cliBridges/types";
import { useGlobalDock } from "@/app/contexts/GlobalDockContext";
import { BranchSelector } from "@/features/chat/components/BranchSelector";
import { ContextWindowButton } from "@/features/chat/components/ContextWindowButton";
import { ClaudeUsageBadge } from "@/features/chat/components/ClaudeUsageBadge";
import { RightWorkspaceControls } from "@/features/workspace";
import type { CliToolId } from "@/features/chat/cliTabs/cliTools";
import type { CliAvailability } from "@/features/chat/cliTabs/ChatTabBar";
import { FolderOpen } from "@/ui/icons";

type BranchProjectContext = ComponentProps<typeof BranchSelector>["projectContext"];
type SetBranchProjectContext = ComponentProps<typeof BranchSelector>["setProjectContext"];
type ClaudeUsageStatus = ComponentProps<typeof ClaudeUsageBadge>["status"];
type ClaudeUsageRateLimit = ComponentProps<typeof ClaudeUsageBadge>["rateLimit"];

interface ChatTopChromeProps {
  conversationTitle?: string;
  projectName?: string;
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
  projectContext?: BranchProjectContext | null;
  setProjectContext: SetBranchProjectContext;
  isEmptyConversation: boolean;
  usageContextTokens: number;
  contextTokens: number;
  contextLimit: number;
  isSummarizing: boolean;
  hasContextSummary: boolean;
  chatEngine: ChatEngine;
  claudeAccountStatus: ClaudeUsageStatus;
  claudeAccountLoading: boolean;
  claudeRateLimit: ClaudeUsageRateLimit;
  onRefreshClaudeAccount: () => void;
  dockedPanelOpen: boolean;
  isTauri: boolean;
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
  onOpenCli?: (id: CliToolId, cwd: string | null) => void;
  cliInfo?: Record<CliToolId, CliAvailability>;
}

export function ChatTopChrome({
  conversationTitle,
  projectName,
  scope,
  onScopeChange,
  projectContext,
  setProjectContext,
  isEmptyConversation,
  usageContextTokens,
  contextTokens,
  contextLimit,
  isSummarizing,
  hasContextSummary,
  chatEngine,
  claudeAccountStatus,
  claudeAccountLoading,
  claudeRateLimit,
  onRefreshClaudeAccount,
  dockedPanelOpen,
  isTauri,
  workspaceOpen,
  onToggleWorkspace,
  onOpenCli,
  cliInfo,
}: ChatTopChromeProps) {
  const { chatDockVisible } = useGlobalDock();
  const usedTokens = usageContextTokens > 0 ? usageContextTokens : contextTokens;
  const titleLabel = scope === "local"
    ? projectName || projectContext?.name || conversationTitle || "Local project"
    : conversationTitle || "New conversation";
  const titleDetail = scope === "local" && conversationTitle ? conversationTitle : undefined;

  return (
    <>
      <div
        className="pointer-events-none fixed top-0 z-toast hidden h-[var(--studio-topbar-height)] items-center min-[980px]:flex"
        style={{
          left: dockedPanelOpen ? 192 : 188,
          right: chatDockVisible ? "calc(50vw + 300px)" : 360,
        }}
      >
        <div
          className="group/context pointer-events-auto relative flex h-8 min-w-0 max-w-full items-center gap-2 rounded-lg px-2 text-xs text-primary transition-colors hover:bg-surface-hover"
          title={titleDetail ? `${titleLabel} / ${titleDetail}` : titleLabel}
        >
          {scope === "local" && <FolderOpen size="sm" className="flex-shrink-0 text-muted" />}
          <span className="min-w-0 truncate font-medium">{titleLabel}</span>
          {projectContext && scope === "local" && (
            <div className="pointer-events-auto"><BranchSelector projectContext={projectContext} setProjectContext={setProjectContext} placement="down" /></div>
          )}
          {!isEmptyConversation && (
            <div className="pointer-events-auto"><ContextWindowButton usedTokens={usedTokens} maxTokens={contextLimit} isSummarizing={isSummarizing} hasContextSummary={hasContextSummary} variant="header" placement="down" /></div>
          )}
          {scope === "local" && chatEngine === "claude" && (
            <div className="pointer-events-auto"><ClaudeUsageBadge status={claudeAccountStatus} loading={claudeAccountLoading} rateLimit={claudeRateLimit} onRefresh={onRefreshClaudeAccount} compact /></div>
          )}
          {titleDetail && (
            <div className="pointer-events-none absolute left-0 top-full z-context mt-1 hidden w-72 rounded-xl border border-surface-border bg-surface-page p-3 shadow-lg group-hover/context:block">
              <p className="truncate text-xs font-semibold text-primary">{titleLabel}</p>
              <p className="mt-1 truncate text-xs text-secondary">{titleDetail}</p>
              {projectContext?.path && (
                <p className="mt-2 break-all text-2xs leading-relaxed text-muted">{projectContext.path}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-auto fixed top-0 right-3.5 z-toast flex h-[var(--studio-topbar-height)] items-center">
        <RightWorkspaceControls
          isTauri={isTauri}
          projectContext={projectContext}
          open={workspaceOpen}
          onToggleOpen={onToggleWorkspace}
          scope={scope}
          onScopeChange={onScopeChange}
          onOpenCli={onOpenCli}
          cliInfo={cliInfo}
        />
      </div>
    </>
  );
}
