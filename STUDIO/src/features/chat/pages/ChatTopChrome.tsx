import type { ComponentProps, MouseEvent } from "react";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ChatEngine } from "@/cliBridges/types";
import { BranchSelector } from "@/features/chat/components/BranchSelector";
import { ChatFloatingDock } from "@/features/chat/components/ChatFloatingDock";
import { ContextWindowButton } from "@/features/chat/components/ContextWindowButton";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import { ClaudeUsageBadge } from "@/features/chat/components/ClaudeUsageBadge";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import { RightWorkspaceControls } from "@/features/workspace";
import type { CliToolId } from "@/features/chat/cliTabs/cliTools";
import type { CliAvailability } from "@/features/chat/cliTabs/ChatTabBar";

type BranchProjectContext = ComponentProps<typeof BranchSelector>["projectContext"];
type SetBranchProjectContext = ComponentProps<typeof BranchSelector>["setProjectContext"];
type ClaudeUsageStatus = ComponentProps<typeof ClaudeUsageBadge>["status"];
type ClaudeUsageRateLimit = ComponentProps<typeof ClaudeUsageBadge>["rateLimit"];

export function ChatTopChrome({
  active,
  conversationTitle,
  projectName,
  scope,
  onScopeChange,
  projects,
  currentProjectPath,
  conversations,
  currentConvId,
  conversationStatuses,
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
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  onSelectConversation,
  onOpenConversationInSideChat,
  onOpenConversationInNewWindow,
  onNewConversation,
  onStartEditTitle,
  onDeleteConversation,
  editingConvId,
  editingConvTitle,
  onEditTitleChange,
  onSaveConvTitle,
  onCancelConvEdit,
  rightPanelWidth,
  isTauri,
  workspaceOpen,
  onToggleWorkspace,
  onOpenCli,
  cliInfo,
}: {
  active: boolean;
  conversationTitle?: string;
  projectName?: string;
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
  projects: ProjectEntry[];
  currentProjectPath?: string;
  conversations: ConversationMetadata[];
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
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
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectConversation: (id: string) => void | Promise<void>;
  onOpenConversationInSideChat: (id: string) => void;
  onOpenConversationInNewWindow: (id: string) => void;
  onNewConversation: () => void;
  onStartEditTitle: (id: string, title: string, event: MouseEvent) => void;
  onDeleteConversation: (id: string, event: MouseEvent) => void;
  editingConvId: string | null;
  editingConvTitle: string;
  onEditTitleChange: (title: string) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
  rightPanelWidth: number;
  isTauri: boolean;
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
  onOpenCli?: (id: CliToolId) => void;
  cliInfo?: Record<CliToolId, CliAvailability>;
}) {
  return (
    <>
      <ChatFloatingDock
        active={active}
        conversationTitle={conversationTitle}
        projectName={projectName}
        scope={scope}
        onScopeChange={onScopeChange}
        projects={projects}
        currentProjectPath={currentProjectPath}
        conversations={conversations}
        currentConvId={currentConvId}
        conversationStatuses={conversationStatuses}
        contextControls={
          <>
            {projectContext && scope === "local" && (
              <BranchSelector
                projectContext={projectContext}
                setProjectContext={setProjectContext}
                placement="down"
              />
            )}
            {!isEmptyConversation && (
              <ContextWindowButton
                usedTokens={usageContextTokens > 0 ? usageContextTokens : contextTokens}
                maxTokens={contextLimit}
                isSummarizing={isSummarizing}
                hasContextSummary={hasContextSummary}
                variant="header"
                placement="down"
              />
            )}
          </>
        }
        accountControl={
          scope === "local" && chatEngine === "claude" ? (
            <ClaudeUsageBadge
              status={claudeAccountStatus}
              loading={claudeAccountLoading}
              rateLimit={claudeRateLimit}
              onRefresh={onRefreshClaudeAccount}
              compact
            />
          ) : null
        }
        onSelectProject={onSelectProject}
        onOpenProjectFolder={onOpenProjectFolder}
        onRemoveProject={onRemoveProject}
        onDeleteProject={onDeleteProject}
        onSelectConversation={onSelectConversation}
        onOpenConversationInSideChat={onOpenConversationInSideChat}
        onOpenConversationInNewWindow={onOpenConversationInNewWindow}
        onNewConversation={onNewConversation}
        onStartEditTitle={onStartEditTitle}
        onDeleteConversation={onDeleteConversation}
        editingConvId={editingConvId}
        editingConvTitle={editingConvTitle}
        onEditTitleChange={onEditTitleChange}
        onSaveConvTitle={onSaveConvTitle}
        onCancelConvEdit={onCancelConvEdit}
      />

      <div
        className="pointer-events-auto fixed top-[9px] z-toast transition-[right] duration-300 ease-standard"
        style={{ right: rightPanelWidth + 14 }}
      >
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
