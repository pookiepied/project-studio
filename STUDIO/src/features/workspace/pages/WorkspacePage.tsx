import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Icon,
  type PhosphorIcon,
  Add,
  Brain,
  Checklist,
  Clock,
  Collapse,
  Delete,
  Document,
  Error,
  FolderOpen,
  Lightning,
  Pause,
  Play,
  Project,
  Reject,
  ShieldCheck,
  Spinner,
  Success,
  ArchiveBoxIcon,
  DatabaseIcon,
  GearSixIcon,
  GraphIcon,
  RobotIcon,
  SpinnerGapIcon,
  UploadSimpleIcon,
} from "@/ui/icons";
import { EmptyState } from "@/ui/primitives/EmptyState";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Input } from "@/ui/primitives/Input";
import { Select } from "@/ui/primitives/Select";
import { Textarea } from "@/ui/primitives/Textarea";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  deleteKbDoc,
  deleteMemoryFact,
  indexKbDocument,
  listKbDocs,
  listMemoryFacts,
  type KbDocument,
  type MemoryFact,
} from "@/features/chat/attachments/kbService";
import {
  createAgent,
  deleteAgent,
  listAgents,
  listRuns,
  runAgent,
  type AgentRun,
  type AgentType,
  type CreateAgentDraft,
  type TriggerType,
  type UserAgent,
} from "@/features/workspace/services/agentWorkflowService";
import { ArtifactLabPanel } from "@/features/artifacts";
import { DocumentList, MemoryList } from "./WorkspaceContextLists";
import { CATEGORY_LABELS, formatBytes, formatRelative } from "./workspaceFormat";

type WorkspaceSection = "overview" | "artifacts" | "context" | "automation" | "activity";

const ACCEPTED_TYPES = ".txt,.md,.json,text/plain,text/markdown,text/x-markdown,application/json";
const STORAGE_LIMIT = 500 * 1024 * 1024;

type LocalIconProps = Omit<React.ComponentProps<typeof Icon>, "icon">;

const makeLocalIcon = (glyph: PhosphorIcon) =>
  forwardRef<SVGSVGElement, LocalIconProps>((props, ref) => (
    <Icon ref={ref} icon={glyph} {...props} />
  ));

const Database = makeLocalIcon(DatabaseIcon);
const GearSix = makeLocalIcon(GearSixIcon);
const Graph = makeLocalIcon(GraphIcon);
const Robot = makeLocalIcon(RobotIcon);
const UploadSimple = makeLocalIcon(UploadSimpleIcon);

const SECTIONS: Array<{ id: WorkspaceSection; label: string; icon: React.ElementType; hint: string }> = [
  { id: "overview", label: "Overview", icon: Project, hint: "Current state" },
  { id: "artifacts", label: "Artifacts", icon: Lightning, hint: "Universal lab" },
  { id: "context", label: "Context", icon: Database, hint: "Docs and memory" },
  { id: "automation", label: "Automation", icon: Robot, hint: "Agents and routines" },
  { id: "activity", label: "Activity", icon: Graph, hint: "Workspace events" },
];

function runStatusIcon(status: AgentRun["status"]) {
  switch (status) {
    case "completed": return <Success size="sm" weight="fill" className="text-secondary" />;
    case "failed": return <Reject size="sm" weight="fill" className="text-secondary" />;
    case "running": return <Spinner size="sm" className="animate-spin text-secondary" />;
    case "queued": return <Clock size="sm" className="text-disabled" />;
    case "cancelled": return <Pause size="sm" weight="fill" className="text-disabled" />;
  }
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="primary"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex gap-1.5 rounded-md bg-primary px-3 py-1.5 h-auto text-xs font-medium text-on-emphasis transition-colors duration-150 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </Button>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 border-r border-surface-divider px-5 py-4 last:border-r-0">
      <p className="text-2xs font-medium uppercase tracking-extra-wide text-disabled">{label}</p>
      <p className="mt-1 truncate text-lg font-display text-primary">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-disabled">{sub}</p>}
    </div>
  );
}

const AGENT_TYPE_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "omni", label: "Omni" },
  { value: "coding", label: "Coding" },
];

const TRIGGER_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "cron", label: "Scheduled" },
];

function CreateAgentForm({
  onSave,
  onCancel,
}: {
  onSave: (draft: CreateAgentDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("omni");
  const [triggerType, setTriggerType] = useState<TriggerType>("manual");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !goal.trim()) {
      setError("Name and goal are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        goal: goal.trim(),
        agentType,
        triggerType,
        cronExpr: triggerType === "cron" ? cronExpr.trim() : undefined,
      });
    } catch (err: any) {
      setError(err.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-b border-surface-divider bg-surface-base/50 px-5 py-4">
      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-secondary">
          <Error size="sm" /> {error}
        </div>
      )}
      <div className="grid grid-cols-[1fr_112px_132px] gap-3">
        <label className="min-w-0">
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-muted">Name</span>
          <Input
            size="md"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Weekly research digest"
            className="rounded-md text-xs dark:bg-surface-raised"
          />
        </label>
        <label>
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-muted">Type</span>
          <Select
            value={agentType}
            onChange={(value) => setAgentType(value as AgentType)}
            options={AGENT_TYPE_OPTIONS}
            className="rounded-md px-2.5 py-2 text-xs text-secondary"
          />
        </label>
        <label>
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-muted">Trigger</span>
          <Select
            value={triggerType}
            onChange={(value) => setTriggerType(value as TriggerType)}
            options={TRIGGER_OPTIONS}
            className="rounded-md px-2.5 py-2 text-xs text-secondary"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-muted">Goal</span>
        <Textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Track model releases, summarize what matters, and produce a short report."
          rows={3}
          className="resize-none text-xs"
        />
      </label>
      <div className="mt-3 flex items-end gap-3">
        {triggerType === "cron" && (
          <label className="w-48">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-muted">Cron UTC</span>
            <Input
              size="md"
              value={cronExpr}
              onChange={(event) => setCronExpr(event.target.value)}
              className="rounded-md font-mono text-xs dark:bg-surface-raised"
            />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} className="px-3 py-1.5 h-auto justify-start text-xs text-muted transition-colors hover:bg-surface-hover">
            Cancel
          </Button>
          <ToolbarButton disabled={saving}>
            {saving && <Spinner size="sm" className="animate-spin" />}
            Save routine
          </ToolbarButton>
        </div>
      </div>
    </form>
  );
}

function AgentRow({
  agent,
  userId,
  onDelete,
  onRun,
}: {
  agent: UserAgent;
  userId: string;
  onDelete: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [busy, setBusy] = useState<"run" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = async () => {
    if (runsLoaded || !userId) return;
    try {
      setRuns(await listRuns(userId, agent.id));
    } catch {
      setRuns([]);
    } finally {
      setRunsLoaded(true);
    }
  };

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) await loadRuns();
  };

  const handleRun = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy("run");
    setError(null);
    try {
      await onRun(agent.id);
      setRuns(await listRuns(userId, agent.id));
      setRunsLoaded(true);
      setExpanded(true);
    } catch (err: any) {
      setError(err.message ?? "Run failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy("delete");
    try {
      await onDelete(agent.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b border-surface-divider last:border-b-0">
      <Button
        variant="ghost"
        onClick={handleExpand}
        className="group w-full items-start justify-start gap-3 px-5 py-3.5 h-auto text-left transition-colors hover:bg-surface-hover"
      >
        <Collapse size="sm" className={`mt-1 flex-shrink-0 text-disabled transition-transform ${expanded ? "rotate-90" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="truncate text-xs font-medium text-primary">{agent.name}</span>
            <span className="rounded bg-surface-base px-1.5 py-0.5 text-2xs font-medium text-muted">{agent.agentType}</span>
            {agent.triggerType === "cron" && agent.cronExpr && (
              <span className="flex items-center gap-1 text-2xs text-disabled">
                <Clock size="xs" /> {agent.cronExpr}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-disabled">{agent.goal}</p>
          {error && <p className="mt-1 text-xs text-secondary">{error}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            aria-label="Run now"
            variant="ghost"
            size="sm"
            onClick={handleRun}
            disabled={busy !== null}
            className="rounded-md text-disabled transition hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 dark:opacity-100 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {busy === "run" ? <Spinner size="sm" className="animate-spin" /> : <Play size="sm" weight="fill" />}
          </IconButton>
          <IconButton
            aria-label="Delete routine"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={busy !== null}
            className="rounded-md text-disabled transition hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 dark:opacity-100 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {busy === "delete" ? <Spinner size="sm" className="animate-spin" /> : <Delete size="sm" />}
          </IconButton>
        </div>
      </Button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            {runs.length === 0 ? (
              <div className="border-t border-surface-divider px-12 py-3 text-xs text-disabled">
                No run history yet.
              </div>
            ) : (
              <ul>
                {runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-2 border-t border-surface-divider px-12 py-2">
                    {runStatusIcon(run.status)}
                    <span className="text-xs capitalize text-muted">{run.status}</span>
                    <span className="text-xs text-disabled">- {formatRelative(run.startedAt)}</span>
                    {run.durationMs !== null && <span className="text-xs text-disabled">- {(run.durationMs / 1000).toFixed(1)}s</span>}
                    {run.error && <span className="ml-1 truncate text-xs text-secondary">{run.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const WorkspacePage = () => {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [section, setSection] = useState<WorkspaceSection>("overview");

  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbError, setKbError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [memLoading, setMemLoading] = useState(true);
  const [memError, setMemError] = useState<string | null>(null);
  const [deletingFactId, setDeletingFactId] = useState<string | null>(null);

  const [agents, setAgents] = useState<UserAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  useEffect(() => {
    if (!userId) {
      setKbLoading(false);
      setMemLoading(false);
      setAgentsLoading(false);
      return;
    }

    setKbLoading(true);
    listKbDocs(userId)
      .then(({ docs: nextDocs, totalBytes: nextBytes }) => {
        setDocs(nextDocs);
        setTotalBytes(nextBytes);
      })
      .catch((err: Error) => setKbError(err.message))
      .finally(() => setKbLoading(false));

    setMemLoading(true);
    listMemoryFacts(userId, 100)
      .then(({ memories }) => setFacts(memories))
      .catch((err: Error) => setMemError(err.message))
      .finally(() => setMemLoading(false));

    setAgentsLoading(true);
    listAgents(userId)
      .then(setAgents)
      .catch((err: Error) => setAgentsError(err.message))
      .finally(() => setAgentsLoading(false));
  }, [userId]);

  const memoryCategories = useMemo(() => new Set(facts.map((fact) => fact.category ?? "knowledge")).size, [facts]);
  const scheduledAgents = useMemo(() => agents.filter((agent) => agent.triggerType === "cron").length, [agents]);
  const storagePct = Math.min(100, Math.round((totalBytes / STORAGE_LIMIT) * 100));

  const timeline = useMemo(() => {
    const docEvents = docs.slice(0, 5).map((doc) => ({
      id: `doc-${doc.id}`,
      icon: Document,
      title: doc.name,
      meta: `Document indexed - ${formatBytes(doc.size)}`,
      ts: doc.createdAt,
    }));
    const agentEvents = agents.slice(0, 5).map((agent) => ({
      id: `agent-${agent.id}`,
      icon: Robot,
      title: agent.name,
      meta: `${agent.triggerType === "cron" ? "Scheduled routine" : "Manual routine"} - ${agent.status}`,
      ts: agent.updatedAt,
    }));
    const memoryEvents = facts.slice(0, 5).map((fact) => ({
      id: `memory-${fact.key}`,
      icon: Brain,
      title: fact.content,
      meta: `Memory - ${CATEGORY_LABELS[fact.category] ?? fact.category}`,
      ts: Date.parse(fact.updatedAt) || Date.now(),
    }));
    return [...docEvents, ...agentEvents, ...memoryEvents].sort((a, b) => b.ts - a.ts).slice(0, 12);
  }, [agents, docs, facts]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;
    event.target.value = "";
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File too large. Max 5 MB.");
      return;
    }
    if (totalBytes + file.size > STORAGE_LIMIT) {
      setUploadError("Workspace storage limit reached.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const text = await file.text();
      const newDoc = await indexKbDocument(text, file.name, file.size, file.type || "text/plain", userId);
      setDocs((prev) => [newDoc, ...prev]);
      setTotalBytes((prev) => prev + file.size);
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: string, size: number) => {
    if (!userId) return;
    setDeletingDocId(docId);
    try {
      await deleteKbDoc(docId, userId);
      setDocs((prev) => prev.filter((doc) => doc.id !== docId));
      setTotalBytes((prev) => Math.max(0, prev - size));
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleDeleteFact = async (factId: string) => {
    if (!userId) return;
    setDeletingFactId(factId);
    try {
      await deleteMemoryFact(factId, userId);
      setFacts((prev) => prev.filter((fact) => fact.key !== factId));
    } finally {
      setDeletingFactId(null);
    }
  };

  const handleSaveAgent = async (draft: CreateAgentDraft) => {
    if (!userId) return;
    const newAgent = await createAgent(userId, draft);
    setAgents((prev) => [newAgent, ...prev]);
    setShowCreateAgent(false);
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!userId) return;
    await deleteAgent(userId, agentId);
    setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
  };

  const handleRunAgent = async (agentId: string) => {
    if (!userId) return;
    await runAgent(userId, agentId);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface-page text-primary transition-colors duration-300">
      <header className="flex-shrink-0 border-b border-surface-divider px-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-display font-normal text-primary">Workspace</h1>
            <p className="mt-1 text-xs text-disabled">Persistent context, working material, and automation for your AI environment.</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Spinner size="sm" className="animate-spin" /> : <UploadSimple size="sm" />}
              {uploading ? "Indexing" : "Add context"}
            </ToolbarButton>
            <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 border-t border-surface-divider">
          <Metric label="Documents" value={kbLoading ? "..." : String(docs.length)} sub={`${formatBytes(totalBytes)} indexed`} />
          <Metric label="Memory" value={memLoading ? "..." : String(facts.length)} sub={`${memoryCategories} categories`} />
          <Metric label="Routines" value={agentsLoading ? "..." : String(agents.length)} sub={`${scheduledAgents} scheduled`} />
          <Metric label="Storage" value={`${storagePct}%`} sub={`${formatBytes(totalBytes)} / ${formatBytes(STORAGE_LIMIT)}`} />
        </div>
      </header>

      {(kbError || memError || agentsError || uploadError) && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-surface-border bg-surface-raised px-6 py-2.5 text-xs text-secondary dark:border-surface-border/40 dark:bg-surface-raised/30 dark:text-secondary">
          <Error size="sm" />
          <span>{uploadError ?? kbError ?? memError ?? agentsError}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr_300px]">
        <aside className="border-r border-surface-divider bg-surface-base/40 p-3">
          <div className="mb-3 px-2 text-2xs font-medium uppercase tracking-extra-wide text-disabled">Workspace OS</div>
          <nav className="space-y-1">
            {SECTIONS.map(({ id, label, icon: SectionIcon, hint }) => (
              <Button
                key={id}
                variant="ghost"
                onClick={() => setSection(id)}
                className={`group w-full items-center gap-3 rounded-md px-2.5 py-2 h-auto justify-start text-left transition-colors ${
                  section === id
                    ? "bg-surface-page shadow-sm"
                    : "hover:bg-surface-hover"
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-base">
                  <SectionIcon size="sm" weight={section === id ? "fill" : undefined} className="text-muted" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-secondary">{label}</span>
                  <span className="block truncate text-2xs text-disabled">{hint}</span>
                </span>
              </Button>
            ))}
          </nav>

          <div className="mt-5 border-t border-surface-divider pt-4">
            <div className="mb-2 px-2 text-2xs font-medium uppercase tracking-extra-wide text-disabled">Status</div>
            <div className="space-y-2 px-2">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Context index</span>
                <span className="text-secondary">Ready</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Agent runtime</span>
                <span className="text-secondary">Disabled</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-base">
                <div className="h-full rounded-full bg-primary" style={{ width: `${storagePct}%` }} />
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            {section === "overview" && (
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="p-6">
                <div className="mb-6">
                  <p className="text-2xs font-medium uppercase tracking-extra-wide text-disabled">Now</p>
                  <h2 className="mt-1 font-display text-xl text-primary">Workspace state</h2>
                </div>
                <div className="grid grid-cols-3 border border-surface-divider">
                  <div className="p-5">
                    <FolderOpen size="lg" className="mb-4 text-muted" />
                    <p className="text-sm font-medium text-primary">{docs.length} documents</p>
                    <p className="mt-1 text-xs leading-relaxed text-disabled">Permanent knowledge currently available to chat and future agents.</p>
                  </div>
                  <div className="border-l border-surface-divider p-5">
                    <Brain size="lg" className="mb-4 text-muted" />
                    <p className="text-sm font-medium text-primary">{facts.length} memory facts</p>
                    <p className="mt-1 text-xs leading-relaxed text-disabled">Distilled user and project context extracted from conversations.</p>
                  </div>
                  <div className="border-l border-surface-divider p-5">
                    <Robot size="lg" className="mb-4 text-muted" />
                    <p className="text-sm font-medium text-primary">{agents.length} routines</p>
                    <p className="mt-1 text-xs leading-relaxed text-disabled">Saved automation definitions. Execution is waiting on the redesigned runtime.</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-[1.2fr_0.8fr] gap-6">
                  <section className="border border-surface-divider">
                    <div className="flex items-center justify-between border-b border-surface-divider px-5 py-3">
                      <div>
                        <p className="text-xs font-medium text-secondary">Recent workspace events</p>
                        <p className="text-xs text-disabled">Documents, memory, and routines in one operational feed.</p>
                      </div>
                    </div>
                    {timeline.length === 0 ? (
                      <EmptyState icon={ArchiveBoxIcon} title="No events yet" body="Add context, build memory, or create routines to populate the workspace timeline." />
                    ) : (
                      <ul className="divide-y divide-surface-divider">
                        {timeline.slice(0, 6).map((event) => (
                          <li key={event.id} className="flex items-center gap-3 px-5 py-3">
                            <event.icon size="sm" className="flex-shrink-0 text-muted" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-secondary">{event.title}</p>
                              <p className="text-xs text-disabled">{event.meta}</p>
                            </div>
                            <span className="flex-shrink-0 text-xs text-disabled">{formatRelative(event.ts)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="border border-surface-divider">
                    <div className="border-b border-surface-divider px-5 py-3">
                      <p className="text-xs font-medium text-secondary">Next controls</p>
                      <p className="text-xs text-disabled">Fast paths into the real workspace objects.</p>
                    </div>
                    <div className="divide-y divide-surface-divider">
                      <Button variant="ghost" onClick={() => setSection("context")} className="w-full items-center gap-3 px-5 py-3 h-auto justify-start text-left transition-colors hover:bg-surface-hover">
                        <Database size="sm" className="text-muted" />
                        <span className="flex-1 text-xs text-secondary">Review context package</span>
                        <Collapse size="sm" className="text-disabled" />
                      </Button>
                      <Button variant="ghost" onClick={() => setSection("automation")} className="w-full items-center gap-3 px-5 py-3 h-auto justify-start text-left transition-colors hover:bg-surface-hover">
                        <Lightning size="sm" className="text-muted" />
                        <span className="flex-1 text-xs text-secondary">Create automation routine</span>
                        <Collapse size="sm" className="text-disabled" />
                      </Button>
                      <Button variant="ghost" onClick={() => setSection("activity")} className="w-full items-center gap-3 px-5 py-3 h-auto justify-start text-left transition-colors hover:bg-surface-hover">
                        <Graph size="sm" className="text-muted" />
                        <span className="flex-1 text-xs text-secondary">Inspect timeline</span>
                        <Collapse size="sm" className="text-disabled" />
                      </Button>
                      <Button variant="ghost" onClick={() => setSection("artifacts")} className="w-full items-center gap-3 px-5 py-3 h-auto justify-start text-left transition-colors hover:bg-surface-hover">
                        <Lightning size="sm" className="text-muted" />
                        <span className="flex-1 text-xs text-secondary">Open artifact lab</span>
                        <Collapse size="sm" className="text-disabled" />
                      </Button>
                    </div>
                  </section>
                </div>
              </motion.div>
            )}

            {section === "artifacts" && (
              <motion.div key="artifacts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="min-h-full">
                <ArtifactLabPanel />
              </motion.div>
            )}

            {section === "context" && (
              <motion.div key="context" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="grid grid-cols-2 gap-0">
                <section className="min-h-full border-r border-surface-divider">
                  <div className="flex items-center justify-between border-b border-surface-divider px-5 py-3">
                    <div>
                      <p className="text-xs font-medium text-secondary">Knowledge base</p>
                      <p className="text-xs text-disabled">{docs.length} documents - {formatBytes(totalBytes)}</p>
                    </div>
                    <ToolbarButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Spinner size="sm" className="animate-spin" /> : <UploadSimple size="sm" />}
                      Add
                    </ToolbarButton>
                  </div>
                  {kbLoading ? <EmptyState icon={SpinnerGapIcon} title="Loading documents" body="Fetching indexed workspace context." /> : <DocumentList docs={docs} deletingDocId={deletingDocId} onDelete={handleDeleteDoc} />}
                </section>
                <section className="min-h-full">
                  <div className="border-b border-surface-divider px-5 py-3">
                    <p className="text-xs font-medium text-secondary">Memory facts</p>
                    <p className="text-xs text-disabled">{facts.length} facts - {memoryCategories} categories</p>
                  </div>
                  {memLoading ? <EmptyState icon={SpinnerGapIcon} title="Loading memory" body="Fetching long-term memory facts." /> : <MemoryList facts={facts} deletingFactId={deletingFactId} onDelete={handleDeleteFact} />}
                </section>
              </motion.div>
            )}

            {section === "automation" && (
              <motion.div key="automation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                <div className="flex items-center justify-between border-b border-surface-divider px-5 py-3">
                  <div>
                    <p className="text-xs font-medium text-secondary">Automation routines</p>
                    <p className="text-xs text-disabled">Saved agent definitions, schedules, and run history.</p>
                  </div>
                  <ToolbarButton onClick={() => setShowCreateAgent((prev) => !prev)}>
                    <Add size="sm" />
                    New routine
                  </ToolbarButton>
                </div>
                <AnimatePresence>
                  {showCreateAgent && <CreateAgentForm onSave={handleSaveAgent} onCancel={() => setShowCreateAgent(false)} />}
                </AnimatePresence>
                {agentsLoading ? (
                  <EmptyState icon={SpinnerGapIcon} title="Loading routines" body="Fetching saved automation definitions." />
                ) : agents.length === 0 && !showCreateAgent ? (
                  <EmptyState icon={RobotIcon} title="No routines yet" body="Create a saved agent with a goal and trigger. Runtime execution will activate when the new agent worker is wired." />
                ) : (
                  <div>
                    {agents.map((agent) => (
                      <AgentRow key={agent.id} agent={agent} userId={userId} onDelete={handleDeleteAgent} onRun={handleRunAgent} />
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {section === "activity" && (
              <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                <div className="border-b border-surface-divider px-5 py-3">
                  <p className="text-xs font-medium text-secondary">Workspace timeline</p>
                  <p className="text-xs text-disabled">A local operational feed assembled from current workspace objects.</p>
                </div>
                {timeline.length === 0 ? (
                  <EmptyState icon={ArchiveBoxIcon} title="No activity yet" body="Events appear after documents, memories, and routines exist." />
                ) : (
                  <ul className="divide-y divide-surface-divider">
                    {timeline.map((event) => (
                      <li key={event.id} className="flex items-center gap-3 px-5 py-3">
                        <event.icon size="sm" className="flex-shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-secondary">{event.title}</p>
                          <p className="text-xs text-disabled">{event.meta}</p>
                        </div>
                        <span className="flex-shrink-0 text-xs text-disabled">{formatRelative(event.ts)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="border-l border-surface-divider bg-surface-base/30 p-5">
          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <Checklist size="sm" className="text-muted" />
              <p className="text-xs font-medium text-secondary">Context package</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Persistent docs</span>
                <span className="text-primary">{docs.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Memory facts</span>
                <span className="text-primary">{facts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Automation routines</span>
                <span className="text-primary">{agents.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Local project map</span>
                <span className="text-disabled">planned</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Artifact lab</span>
                <span className="text-primary">ready</span>
              </div>
            </div>
          </section>

          <section className="mb-6 border-t border-surface-divider pt-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size="sm" className="text-muted" />
              <p className="text-xs font-medium text-secondary">Workspace policy</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Memory injection</span>
                <span className="text-primary">On</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Agent autonomy</span>
                <span className="text-secondary">approval</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Desktop control</span>
                <span className="text-disabled">separate mode</span>
              </div>
            </div>
          </section>

          <section className="border-t border-surface-divider pt-5">
            <div className="mb-3 flex items-center gap-2">
              <GearSix size="sm" className="text-muted" />
              <p className="text-xs font-medium text-secondary">Build notes</p>
            </div>
            <p className="text-xs leading-relaxed text-disabled">
              This page uses existing KB, memory, workflow APIs, and a local artifact lab for previewing universal artifact payloads. Project maps, permissions, and real agent execution can be wired in as those backend surfaces land.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};
