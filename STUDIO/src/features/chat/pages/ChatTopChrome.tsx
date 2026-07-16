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
  rightPanelWidth: number;
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
  rightPanelWidth,
  isTauri,
  workspaceOpen,
  onToggleWorkspace,
  onOpenCli,
  cliInfo,
}: ChatTopChromeProps) {
  const { chatDockVisible } = useGlobalDock();
  const usedTokens = usageContextTokens > 0 ? usageContextTokens : contextTokens;

  return (
    <>
      <div className={`pointer-events-none fixed inset-x-0 top-0 z-toast flex h-[var(--studio-topbar-height)] items-center justify-center transition-opacity duration-150 ${chatDockVisible ? "invisible opacity-0" : "visible opacity-100"}`} aria-hidden={chatDockVisible}>
        <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-xs" style={{ maxWidth: "max(180px, min(520px, calc(100vw - 560px)))" }}>
          {projectName && scope === "local" && <><FolderOpen size="sm" className="flex-shrink-0 text-muted" /><span className="max-w-32 truncate text-secondary">{projectName}</span><span className="text-muted">/</span></>}
          <span className="min-w-0 truncate font-medium text-primary">{conversationTitle || "New conversation"}</span>
          {projectContext && scope === "local" && (
            <div className="pointer-events-auto"><BranchSelector projectContext={projectContext} setProjectContext={setProjectContext} placement="down" /></div>
          )}
          {!isEmptyConversation && (
            <div className="pointer-events-auto"><ContextWindowButton usedTokens={usedTokens} maxTokens={contextLimit} isSummarizing={isSummarizing} hasContextSummary={hasContextSummary} variant="header" placement="down" /></div>
          )}
          {scope === "local" && chatEngine === "claude" && (
            <div className="pointer-events-auto"><ClaudeUsageBadge status={claudeAccountStatus} loading={claudeAccountLoading} rateLimit={claudeRateLimit} onRefresh={onRefreshClaudeAccount} compact /></div>
          )}
        </div>
      </div>

      <div className="pointer-events-auto fixed top-0 z-toast flex h-[var(--studio-topbar-height)] items-center transition-[right] duration-300 ease-standard" style={{ right: rightPanelWidth + 14 }}>
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
