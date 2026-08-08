import type { ComponentProps, ComponentType } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import type { ChatMessage, MessageSegment } from "@/types";
import type { ActiveToolCall, TaskItem } from "@/types/tools";
import {
  Check,
  Close,
  Code,
  Conversation,
  Files,
  Globe,
  Icon,
  GitBranchIcon,
  RobotIcon,
  SparkleIcon,
  Terminal,
} from "@/ui/icons";
import { IconButton } from "@/ui/primitives/IconButton";
import type { WorkspaceTabType } from "./types";

type WorkspaceVisualIcon = ComponentType<ComponentProps<typeof Globe>>;

interface ConversationWorkspacePanelProps {
  messages: ChatMessage[];
  activeToolCalls: ActiveToolCall[];
  sessionTasks: TaskItem[];
  pendingMessages: unknown[];
  harnessSegments: MessageSegment[];
  contextTokens: number;
  contextLimit: number;
  usageContextTokens: number;
  isLoading: boolean;
  isStreaming: boolean;
  isSummarizing: boolean;
  projectName?: string | null;
  conversationTitle?: string | null;
  tabsOpen: number;
  onLaunch: (type: WorkspaceTabType) => void;
  onClose: () => void;
}

interface ActivityPoint {
  turn: string;
  tokens: number;
}

const DEMO_MONTHLY_TOKEN_BUDGET = 2_000_000;
const MAX_ACTIVITY_POINTS = 14;

const LAUNCHERS: Array<{ type: WorkspaceTabType; label: string; Icon: WorkspaceVisualIcon }> = [
  { type: "review", label: "Review", Icon: GitBranchGlyph },
  { type: "browser", label: "Browser", Icon: Globe },
  { type: "terminal", label: "Terminal", Icon: Terminal },
  { type: "files", label: "Files", Icon: Files },
  { type: "side-chat", label: "Chat", Icon: Conversation },
  { type: "artifacts", label: "Artifacts", Icon: Code },
];

function GitBranchGlyph(props: ComponentProps<typeof Globe>) {
  return <Icon icon={GitBranchIcon} {...props} />;
}

function percent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function compactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

function activeLabel({
  isLoading,
  isStreaming,
  activeToolCalls,
  pendingMessages,
}: Pick<ConversationWorkspacePanelProps, "isLoading" | "isStreaming" | "activeToolCalls" | "pendingMessages">) {
  if (activeToolCalls.some((call) => call.status === "pending_approval")) return "approval";
  if (activeToolCalls.some((call) => call.status === "pending_question")) return "question";
  if (activeToolCalls.some((call) => call.status === "running")) return "running";
  if (isStreaming) return "responding";
  if (isLoading) return "preparing";
  if (pendingMessages.length > 0) return "queued";
  return "ready";
}

function estimateMessageTokens(message: ChatMessage) {
  const prose = message.content.length / 4;
  const thinking = (message.thinkingContent?.length ?? 0) / 6;
  const toolWeight = (message.segments?.filter((segment) => segment.type === "harness_event").length ?? 0) * 90;
  return Math.max(0, Math.round(prose + thinking + toolWeight));
}

function buildTurnActivity(messages: ChatMessage[]): ActivityPoint[] {
  const visible = messages.slice(-MAX_ACTIVITY_POINTS);
  if (visible.length === 0) {
    return Array.from({ length: 8 }, (_, index) => ({ turn: String(index + 1), tokens: 0 }));
  }

  return visible.map((message, index) => ({
    turn: String(Math.max(1, messages.length - visible.length + index + 1)),
    tokens: estimateMessageTokens(message),
  }));
}

export function ConversationWorkspacePanel({
  messages,
  activeToolCalls,
  sessionTasks,
  pendingMessages,
  harnessSegments,
  contextTokens,
  contextLimit,
  usageContextTokens,
  isLoading,
  isStreaming,
  isSummarizing,
  tabsOpen,
  onLaunch,
  onClose,
}: ConversationWorkspacePanelProps) {
  const contextUsed = usageContextTokens > 0 ? usageContextTokens : contextTokens;
  const trackedTokens = Math.max(
    contextUsed,
    Math.round(messages.reduce((total, message) => total + estimateMessageTokens(message), 0) + harnessSegments.length * 120),
  );
  const monthPct = percent(trackedTokens, DEMO_MONTHLY_TOKEN_BUDGET);
  const contextPct = percent(contextUsed, contextLimit);
  const status = isSummarizing
    ? "summarizing"
    : activeLabel({ isLoading, isStreaming, activeToolCalls, pendingMessages });
  const activity = buildTurnActivity(messages);
  const visibleTasks = sessionTasks.slice(0, 4);
  const completedTasks = sessionTasks.filter((task) => task.status === "completed").length;
  const visibleAgents = activeToolCalls.slice(0, 3);
  const ringStop = Math.max(monthPct, trackedTokens > 0 ? 2 : 0);
  const budgetRing = `conic-gradient(from 210deg, oklch(0.67 0.18 42) 0 ${ringStop * 0.62}%, oklch(0.68 0.14 218) ${ringStop * 0.62}% ${ringStop}%, var(--surface-selected) ${ringStop}% 100%)`;
  const peakTokens = Math.max(...activity.map((point) => point.tokens), 0);

  return (
    <section
      className="grid h-full min-h-0 grid-rows-[minmax(0,1.08fr)_minmax(0,0.66fr)_minmax(0,0.86fr)_2.75rem] overflow-hidden bg-surface-page"
      aria-label="Conversation workspace"
    >
      <section className="relative grid min-h-0 grid-rows-[2.9rem_minmax(0,1fr)] overflow-hidden px-4 pt-2" aria-label="Turn activity">
        <div className="flex min-w-0 items-center gap-3 pr-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-normal text-primary">{messages.length}</span>
              <span className="text-xs text-secondary">turns</span>
            </div>
            <p className="text-3xs uppercase tracking-extra-wide text-muted">Conversation activity</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-primary">{compactNumber(peakTokens)}</p>
            <p className="text-3xs text-muted">peak tokens</p>
          </div>
        </div>

        <IconButton
          aria-label="Close workspace"
          title="Close workspace"
          variant="ghost"
          onClick={onClose}
          className="absolute right-2 top-2 h-7 w-7 rounded-full text-muted"
        >
          <Close size="sm" />
        </IconButton>

        <div className="min-h-0 min-w-0 pb-1">
          <ResponsiveContainer width="100%" height="100%" minHeight={90}>
            <AreaChart data={activity} margin={{ top: 8, right: 3, bottom: 0, left: 3 }}>
              <defs>
                <linearGradient id="workspace-activity-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.68 0.18 42)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="oklch(0.68 0.18 42)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--surface-divider)" strokeOpacity={0.72} />
              <XAxis
                dataKey="turn"
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                tick={{ fontSize: 8, fill: "var(--text-muted)" }}
                tickFormatter={(value: string) => `#${value}`}
              />
              <Tooltip
                cursor={{ stroke: "var(--text-muted)", strokeWidth: 1, strokeDasharray: "3 3" }}
                content={(props) => (
                  <ActivityTooltip
                    active={props.active}
                    label={props.label as string | undefined}
                    payload={props.payload as unknown as Array<{ value?: number }> | undefined}
                  />
                )}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="oklch(0.65 0.19 42)"
                strokeWidth={2.25}
                fill="url(#workspace-activity-fill)"
                dot={false}
                activeDot={{ r: 3, fill: "oklch(0.65 0.19 42)", stroke: "var(--surface-page)", strokeWidth: 2 }}
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid min-h-0 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-4 overflow-hidden px-4 py-2" aria-label="Usage and agents">
        <div className="flex h-full min-h-0 items-center justify-center">
          <div className="relative aspect-square h-[min(100%,7rem)] max-h-28 min-h-20 p-[0.45rem]" style={{ background: budgetRing, borderRadius: "50%" }}>
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-surface-page">
              <span className="font-display text-2xl font-normal text-primary">{monthPct}%</span>
              <span className="text-3xs uppercase tracking-extra-wide text-muted">monthly</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col justify-center">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-2xs font-medium text-secondary">Context</p>
              <p className="text-3xs text-muted">{compactNumber(contextUsed)} of {compactNumber(contextLimit)}</p>
            </div>
            <span className="font-display text-xl text-primary">{contextPct}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-selected">
            <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${contextPct}%` }} />
          </div>
          <AgentRail agents={visibleAgents} status={status} />
        </div>
      </section>

      <section className="grid min-h-0 grid-rows-[2rem_minmax(0,1fr)] overflow-hidden bg-surface-base px-4 py-2" aria-label="Task flow">
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs font-medium uppercase tracking-extra-wide text-muted">Tasks</p>
          <p className="text-2xs text-muted">{completedTasks} / {sessionTasks.length}</p>
        </div>
        <div className="relative min-h-0 overflow-hidden">
          {visibleTasks.length > 1 && <span className="absolute bottom-[12%] left-[0.6875rem] top-[12%] w-px bg-surface-border" />}
          <div className="grid h-full min-h-0 content-center gap-1" style={{ gridTemplateRows: `repeat(${Math.max(visibleTasks.length, 1)}, minmax(0, 2.75rem))` }}>
            {visibleTasks.length > 0 ? visibleTasks.map((task, index) => (
              <TaskChainItem key={`${task.content}-${index}`} task={task} index={index} />
            )) : (
              <div className="flex min-w-0 items-center gap-3">
                <span className="z-[1] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-base text-muted">
                  <Icon icon={SparkleIcon} size="xs" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-secondary">Waiting for the next task</p>
                  <p className="text-3xs uppercase tracking-extra-wide text-muted">idle</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <nav className="flex items-center justify-around bg-surface-base px-2" aria-label={`Workspace tools, ${tabsOpen} open`}>
        {LAUNCHERS.map(({ type, label, Icon: LaunchIcon }) => (
          <IconButton
            key={type}
            aria-label={label}
            title={label}
            variant="ghost"
            onClick={() => onLaunch(type)}
            className="h-8 w-8 rounded-full text-muted hover:bg-surface-hover hover:text-primary"
          >
            <LaunchIcon size="sm" />
          </IconButton>
        ))}
      </nav>
    </section>
  );
}

function ActivityTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ value?: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-surface-border bg-surface-page px-2 py-1 shadow-sm">
      <p className="text-3xs text-muted">Turn {label}</p>
      <p className="text-xs font-medium text-primary">{compactNumber(payload[0]?.value ?? 0)} tokens</p>
    </div>
  );
}

function AgentRail({ agents, status }: { agents: ActiveToolCall[]; status: string }) {
  const nodes = agents.length > 0 ? agents : [{
    callId: "conversation-agent",
    tool: status === "ready" ? "AI ready" : status,
    args: {},
    status: status === "ready" ? "complete" : "running",
    type: "sub_agent" as const,
  }];

  return (
    <div className="mt-3 flex min-w-0 items-center gap-3 overflow-hidden" aria-label="Active agents">
      {nodes.map((agent) => {
        const running = agent.status === "running";
        return (
          <div key={agent.callId} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${running ? "bg-primary text-inverse" : "bg-surface-selected text-muted"}`}>
              <Icon icon={agent.type === "sub_agent" ? RobotIcon : SparkleIcon} size="xs" />
            </span>
            <span className="min-w-0 truncate text-3xs text-muted">{agent.tool}</span>
          </div>
        );
      })}
    </div>
  );
}

function TaskChainItem({ task, index }: { task: TaskItem; index: number }) {
  const done = task.status === "completed";
  const active = task.status === "in_progress";

  return (
    <div className="relative flex min-w-0 items-center gap-3 overflow-hidden">
      <span className={`z-[1] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border bg-surface-base ${done || active ? "border-primary text-primary" : "border-surface-border text-muted"}`}>
        {done ? <Check size="xs" /> : <span className="text-3xs font-medium">{index + 1}</span>}
      </span>
      <div className="min-w-0">
        <p className={`truncate text-xs ${done ? "text-muted line-through" : "text-primary"}`}>
          {active ? task.activeForm : task.content}
        </p>
        <p className="text-3xs uppercase tracking-extra-wide text-muted">{task.status.replace("_", " ")}</p>
      </div>
    </div>
  );
}
