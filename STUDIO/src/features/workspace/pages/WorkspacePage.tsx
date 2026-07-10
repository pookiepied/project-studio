import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArchiveBoxIcon as ArchiveBox,
  BrainIcon as Brain,
  BriefcaseIcon as Briefcase,
  CaretRightIcon as CaretRight,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  GearSixIcon as GearSix,
  GraphIcon as Graph,
  LightningIcon as Lightning,
  ListChecksIcon as ListChecks,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RobotIcon as Robot,
  ShieldCheckIcon as ShieldCheck,
  SpinnerGapIcon as SpinnerGap,
  TagIcon as Tag,
  TrashIcon as Trash,
  UploadSimpleIcon as UploadSimple,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import { EmptyState } from "@/ui/primitives/EmptyState";
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

type WorkspaceSection = "overview" | "artifacts" | "context" | "automation" | "activity";

const ACCEPTED_TYPES = ".txt,.md,.json,text/plain,text/markdown,text/x-markdown,application/json";
const STORAGE_LIMIT = 500 * 1024 * 1024;

const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identity",
  preference: "Preferences",
  project: "Projects",
  event: "Events",
  knowledge: "Knowledge",
};

const SECTIONS: Array<{ id: WorkspaceSection; label: string; icon: React.ElementType; hint: string }> = [
  { id: "overview", label: "Overview", icon: Briefcase, hint: "Current state" },
  { id: "artifacts", label: "Artifacts", icon: Lightning, hint: "Universal lab" },
  { id: "context", label: "Context", icon: Database, hint: "Docs and memory" },
  { id: "automation", label: "Automation", icon: Robot, hint: "Agents and routines" },
  { id: "activity", label: "Activity", icon: Graph, hint: "Workspace events" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return formatDate(ts);
}

function runStatusIcon(status: AgentRun["status"]) {
  switch (status) {
    case "completed": return <CheckCircle size={12} weight="fill" className="text-secondary" />;
    case "failed": return <XCircle size={12} weight="fill" className="text-secondary" />;
    case "running": return <SpinnerGap size={12} className="animate-spin text-secondary" />;
    case "queued": return <Clock size={12} className="text-gray-400" />;
    case "cancelled": return <Pause size={12} weight="fill" className="text-gray-400" />;
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
    >
      {children}
    </button>
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
    <div className="min-w-0 border-r border-gray-100 px-5 py-4 last:border-r-0 dark:border-surface-divider">
      <p className="text-2xs font-medium uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">{label}</p>
      <p className="mt-1 truncate text-lg font-display text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-600">{sub}</p>}
    </div>
  );
}

function DocumentList({
  docs,
  deletingDocId,
  onDelete,
}: {
  docs: KbDocument[];
  deletingDocId: string | null;
  onDelete: (id: string, size: number) => void;
}) {
  if (docs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        body="Add project notes, specs, research, or JSON context that should survive across conversations."
      />
    );
  }

  return (
    <ul className="divide-y divide-gray-50 dark:divide-surface-divider">
      {docs.map((doc) => (
        <li key={doc.id} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50/70 dark:hover:bg-white/[0.02]">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-surface-raised">
            <FileText size={14} weight="duotone" className="text-gray-400 dark:text-gray-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200" title={doc.name}>{doc.name}</p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-600">
              {formatBytes(doc.size)} · {doc.chunkCount} chunks · {formatDate(doc.createdAt)}
              {doc.truncated && <span className="ml-1.5 text-secondary">truncated</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(doc.id, doc.size)}
            disabled={deletingDocId === doc.id}
            title="Delete document"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-300 opacity-0 transition-all hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100 dark:text-gray-700 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {deletingDocId === doc.id ? <SpinnerGap size={13} className="animate-spin" /> : <Trash size={13} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MemoryList({
  facts,
  deletingFactId,
  onDelete,
}: {
  facts: MemoryFact[];
  deletingFactId: string | null;
  onDelete: (id: string) => void;
}) {
  const grouped = useMemo(() => facts.reduce<Record<string, MemoryFact[]>>((acc, fact) => {
    const key = fact.category ?? "knowledge";
    (acc[key] ??= []).push(fact);
    return acc;
  }, {}), [facts]);

  const categories = Object.keys(grouped).sort();

  if (facts.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title="No memories yet"
        body="Memory facts will appear here as conversations are distilled into reusable user context."
      />
    );
  }

  return (
    <div className="py-2">
      {categories.map((cat) => (
        <section key={cat} className="mb-2">
          <div className="px-5 py-2">
            <span className="text-2xs font-semibold uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">
              {CATEGORY_LABELS[cat] ?? cat}
            </span>
          </div>
          <ul>
            {grouped[cat].map((fact) => (
              <li key={fact.key} className="group flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">{fact.content}</p>
                  {fact.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Tag size={9} className="text-gray-300 dark:text-gray-700" />
                      {fact.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded bg-gray-100/80 px-1.5 py-0.5 text-2xs text-gray-400 dark:bg-surface-raised dark:text-gray-600">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">
                  <span
                    title={`Importance: ${fact.importance}/10`}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `hsl(${(fact.importance ?? 5) * 12}, 60%, 55%)` }}
                  />
                  <button
                    type="button"
                    onClick={() => onDelete(fact.key)}
                    disabled={deletingFactId === fact.key}
                    title="Delete memory"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 opacity-0 transition-all hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100 dark:text-gray-700 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
                  >
                    {deletingFactId === fact.key ? <SpinnerGap size={13} className="animate-spin" /> : <Trash size={13} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
    <form onSubmit={handleSubmit} className="border-b border-gray-100 bg-gray-50/50 px-5 py-4 dark:border-surface-divider dark:bg-white/[0.015]">
      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-secondary">
          <WarningCircle size={13} /> {error}
        </div>
      )}
      <div className="grid grid-cols-[1fr_112px_132px] gap-3">
        <label className="min-w-0">
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-gray-500 dark:text-gray-500">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Weekly research digest"
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-raised dark:text-gray-200 dark:focus:border-gray-200"
          />
        </label>
        <label>
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-gray-500 dark:text-gray-500">Type</span>
          <select
            value={agentType}
            onChange={(event) => setAgentType(event.target.value as AgentType)}
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-raised dark:text-gray-300 dark:focus:border-gray-200"
          >
            {AGENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-gray-500 dark:text-gray-500">Trigger</span>
          <select
            value={triggerType}
            onChange={(event) => setTriggerType(event.target.value as TriggerType)}
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-raised dark:text-gray-300 dark:focus:border-gray-200"
          >
            {TRIGGER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-gray-500 dark:text-gray-500">Goal</span>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Track model releases, summarize what matters, and produce a short report."
          rows={3}
          className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-raised dark:text-gray-200 dark:focus:border-gray-200"
        />
      </label>
      <div className="mt-3 flex items-end gap-3">
        {triggerType === "cron" && (
          <label className="w-48">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-extra-wide text-gray-500 dark:text-gray-500">Cron UTC</span>
            <input
              value={cronExpr}
              onChange={(event) => setCronExpr(event.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-raised dark:text-gray-200 dark:focus:border-gray-200"
            />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-surface-raised">
            Cancel
          </button>
          <ToolbarButton disabled={saving}>
            {saving && <SpinnerGap size={12} className="animate-spin" />}
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
    <div className="border-b border-gray-50 last:border-b-0 dark:border-surface-divider">
      <button
        type="button"
        onClick={handleExpand}
        className="group flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50/70 dark:hover:bg-white/[0.02]"
      >
        <CaretRight size={12} className={`mt-1 flex-shrink-0 text-gray-300 transition-transform dark:text-gray-700 ${expanded ? "rotate-90" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{agent.name}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs font-medium text-gray-500 dark:bg-surface-raised dark:text-gray-500">{agent.agentType}</span>
            {agent.triggerType === "cron" && agent.cronExpr && (
              <span className="flex items-center gap-1 text-2xs text-gray-400 dark:text-gray-600">
                <Clock size={9} /> {agent.cronExpr}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-400 dark:text-gray-600">{agent.goal}</p>
          {error && <p className="mt-1 text-xs text-secondary">{error}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleRun}
            disabled={busy !== null}
            title="Run now"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {busy === "run" ? <SpinnerGap size={13} className="animate-spin" /> : <Play size={13} weight="fill" />}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy !== null}
            title="Delete routine"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 transition hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-700 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {busy === "delete" ? <SpinnerGap size={13} className="animate-spin" /> : <Trash size={13} />}
          </button>
        </div>
      </button>
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
              <div className="border-t border-gray-50 px-12 py-3 text-xs text-gray-400 dark:border-surface-divider dark:text-gray-600">
                No run history yet.
              </div>
            ) : (
              <ul>
                {runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-2 border-t border-gray-50 px-12 py-2 dark:border-surface-divider">
                    {runStatusIcon(run.status)}
                    <span className="text-xs capitalize text-gray-500 dark:text-gray-400">{run.status}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-600">· {formatRelative(run.startedAt)}</span>
                    {run.durationMs !== null && <span className="text-xs text-gray-400 dark:text-gray-600">· {(run.durationMs / 1000).toFixed(1)}s</span>}
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
      icon: FileText,
      title: doc.name,
      meta: `Document indexed · ${formatBytes(doc.size)}`,
      ts: doc.createdAt,
    }));
    const agentEvents = agents.slice(0, 5).map((agent) => ({
      id: `agent-${agent.id}`,
      icon: Robot,
      title: agent.name,
      meta: `${agent.triggerType === "cron" ? "Scheduled routine" : "Manual routine"} · ${agent.status}`,
      ts: agent.updatedAt,
    }));
    const memoryEvents = facts.slice(0, 5).map((fact) => ({
      id: `memory-${fact.key}`,
      icon: Brain,
      title: fact.content,
      meta: `Memory · ${CATEGORY_LABELS[fact.category] ?? fact.category}`,
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
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-gray-900 transition-colors duration-300 dark:bg-surface-page dark:text-gray-100">
      <header className="flex-shrink-0 border-b border-gray-100 px-6 pt-5 dark:border-surface-divider">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-normal tracking-tight text-gray-950 dark:text-gray-50">Workspace</h1>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-600">Persistent context, working material, and automation for your AI environment.</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <SpinnerGap size={12} className="animate-spin" /> : <UploadSimple size={12} weight="bold" />}
              {uploading ? "Indexing" : "Add context"}
            </ToolbarButton>
            <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 border-t border-gray-50 dark:border-surface-divider">
          <Metric label="Documents" value={kbLoading ? "..." : String(docs.length)} sub={`${formatBytes(totalBytes)} indexed`} />
          <Metric label="Memory" value={memLoading ? "..." : String(facts.length)} sub={`${memoryCategories} categories`} />
          <Metric label="Routines" value={agentsLoading ? "..." : String(agents.length)} sub={`${scheduledAgents} scheduled`} />
          <Metric label="Storage" value={`${storagePct}%`} sub={`${formatBytes(totalBytes)} / ${formatBytes(STORAGE_LIMIT)}`} />
        </div>
      </header>

      {(kbError || memError || agentsError || uploadError) && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-surface-border bg-surface-raised px-6 py-2.5 text-xs text-secondary dark:border-surface-border/40 dark:bg-surface-raised/30 dark:text-secondary">
          <WarningCircle size={14} />
          <span>{uploadError ?? kbError ?? memError ?? agentsError}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr_300px]">
        <aside className="border-r border-gray-100 bg-gray-50/40 p-3 dark:border-surface-divider dark:bg-white/[0.01]">
          <div className="mb-3 px-2 text-2xs font-medium uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">Workspace OS</div>
          <nav className="space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                  section === id
                    ? "bg-white shadow-sm dark:bg-surface-base"
                    : "hover:bg-white/80 dark:hover:bg-white/[0.03]"
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 dark:bg-surface-raised">
                  <Icon size={14} weight={section === id ? "duotone" : "regular"} className="text-gray-500 dark:text-gray-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
                  <span className="block truncate text-2xs text-gray-400 dark:text-gray-600">{hint}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-surface-divider">
            <div className="mb-2 px-2 text-2xs font-medium uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">Status</div>
            <div className="space-y-2 px-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
                <span>Context index</span>
                <span className="text-gray-800 dark:text-gray-300">Ready</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
                <span>Agent runtime</span>
                <span className="text-secondary">Disabled</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-surface-raised">
                <div className="h-full rounded-full bg-gray-700 dark:bg-gray-300" style={{ width: `${storagePct}%` }} />
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            {section === "overview" && (
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="p-6">
                <div className="mb-6">
                  <p className="text-2xs font-medium uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">Now</p>
                  <h2 className="mt-1 font-display text-xl text-gray-900 dark:text-gray-100">Workspace state</h2>
                </div>
                <div className="grid grid-cols-3 border border-gray-100 dark:border-surface-divider">
                  <div className="p-5">
                    <FolderOpen size={18} className="mb-4 text-gray-400" />
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{docs.length} documents</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400 dark:text-gray-600">Permanent knowledge currently available to chat and future agents.</p>
                  </div>
                  <div className="border-l border-gray-100 p-5 dark:border-surface-divider">
                    <Brain size={18} className="mb-4 text-gray-400" />
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{facts.length} memory facts</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400 dark:text-gray-600">Distilled user and project context extracted from conversations.</p>
                  </div>
                  <div className="border-l border-gray-100 p-5 dark:border-surface-divider">
                    <Robot size={18} className="mb-4 text-gray-400" />
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{agents.length} routines</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400 dark:text-gray-600">Saved automation definitions. Execution is waiting on the redesigned runtime.</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-[1.2fr_0.8fr] gap-6">
                  <section className="border border-gray-100 dark:border-surface-divider">
                    <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Recent workspace events</p>
                        <p className="text-xs text-gray-400 dark:text-gray-600">Documents, memory, and routines in one operational feed.</p>
                      </div>
                    </div>
                    {timeline.length === 0 ? (
                      <EmptyState icon={ArchiveBox} title="No events yet" body="Add context, build memory, or create routines to populate the workspace timeline." />
                    ) : (
                      <ul className="divide-y divide-gray-50 dark:divide-surface-divider">
                        {timeline.slice(0, 6).map((event) => (
                          <li key={event.id} className="flex items-center gap-3 px-5 py-3">
                            <event.icon size={14} className="flex-shrink-0 text-gray-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">{event.title}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-600">{event.meta}</p>
                            </div>
                            <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-600">{formatRelative(event.ts)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="border border-gray-100 dark:border-surface-divider">
                    <div className="border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Next controls</p>
                      <p className="text-xs text-gray-400 dark:text-gray-600">Fast paths into the real workspace objects.</p>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-surface-divider">
                      <button type="button" onClick={() => setSection("context")} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <Database size={14} className="text-gray-400" />
                        <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">Review context package</span>
                        <CaretRight size={12} className="text-gray-300" />
                      </button>
                      <button type="button" onClick={() => setSection("automation")} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <Lightning size={14} className="text-gray-400" />
                        <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">Create automation routine</span>
                        <CaretRight size={12} className="text-gray-300" />
                      </button>
                      <button type="button" onClick={() => setSection("activity")} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <Graph size={14} className="text-gray-400" />
                        <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">Inspect timeline</span>
                        <CaretRight size={12} className="text-gray-300" />
                      </button>
                      <button type="button" onClick={() => setSection("artifacts")} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <Lightning size={14} className="text-gray-400" />
                        <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">Open artifact lab</span>
                        <CaretRight size={12} className="text-gray-300" />
                      </button>
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
                <section className="min-h-full border-r border-gray-100 dark:border-surface-divider">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                    <div>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Knowledge base</p>
                      <p className="text-xs text-gray-400 dark:text-gray-600">{docs.length} documents · {formatBytes(totalBytes)}</p>
                    </div>
                    <ToolbarButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <SpinnerGap size={12} className="animate-spin" /> : <UploadSimple size={12} />}
                      Add
                    </ToolbarButton>
                  </div>
                  {kbLoading ? <EmptyState icon={SpinnerGap} title="Loading documents" body="Fetching indexed workspace context." /> : <DocumentList docs={docs} deletingDocId={deletingDocId} onDelete={handleDeleteDoc} />}
                </section>
                <section className="min-h-full">
                  <div className="border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Memory facts</p>
                    <p className="text-xs text-gray-400 dark:text-gray-600">{facts.length} facts · {memoryCategories} categories</p>
                  </div>
                  {memLoading ? <EmptyState icon={SpinnerGap} title="Loading memory" body="Fetching long-term memory facts." /> : <MemoryList facts={facts} deletingFactId={deletingFactId} onDelete={handleDeleteFact} />}
                </section>
              </motion.div>
            )}

            {section === "automation" && (
              <motion.div key="automation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Automation routines</p>
                    <p className="text-xs text-gray-400 dark:text-gray-600">Saved agent definitions, schedules, and run history.</p>
                  </div>
                  <ToolbarButton onClick={() => setShowCreateAgent((prev) => !prev)}>
                    <Plus size={12} weight="bold" />
                    New routine
                  </ToolbarButton>
                </div>
                <AnimatePresence>
                  {showCreateAgent && <CreateAgentForm onSave={handleSaveAgent} onCancel={() => setShowCreateAgent(false)} />}
                </AnimatePresence>
                {agentsLoading ? (
                  <EmptyState icon={SpinnerGap} title="Loading routines" body="Fetching saved automation definitions." />
                ) : agents.length === 0 && !showCreateAgent ? (
                  <EmptyState icon={Robot} title="No routines yet" body="Create a saved agent with a goal and trigger. Runtime execution will activate when the new agent worker is wired." />
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
                <div className="border-b border-gray-100 px-5 py-3 dark:border-surface-divider">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Workspace timeline</p>
                  <p className="text-xs text-gray-400 dark:text-gray-600">A local operational feed assembled from current workspace objects.</p>
                </div>
                {timeline.length === 0 ? (
                  <EmptyState icon={ArchiveBox} title="No activity yet" body="Events appear after documents, memories, and routines exist." />
                ) : (
                  <ul className="divide-y divide-gray-50 dark:divide-surface-divider">
                    {timeline.map((event) => (
                      <li key={event.id} className="flex items-center gap-3 px-5 py-3">
                        <event.icon size={14} className="flex-shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">{event.title}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-600">{event.meta}</p>
                        </div>
                        <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-600">{formatRelative(event.ts)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="border-l border-gray-100 bg-gray-50/30 p-5 dark:border-surface-divider dark:bg-white/[0.01]">
          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <ListChecks size={14} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Context package</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Persistent docs</span>
                <span className="text-gray-800 dark:text-gray-300">{docs.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Memory facts</span>
                <span className="text-gray-800 dark:text-gray-300">{facts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Automation routines</span>
                <span className="text-gray-800 dark:text-gray-300">{agents.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Local project map</span>
                <span className="text-gray-400 dark:text-gray-600">planned</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Artifact lab</span>
                <span className="text-gray-800 dark:text-gray-300">ready</span>
              </div>
            </div>
          </section>

          <section className="mb-6 border-t border-gray-100 pt-5 dark:border-surface-divider">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Workspace policy</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Memory injection</span>
                <span className="text-gray-800 dark:text-gray-300">On</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Agent autonomy</span>
                <span className="text-secondary">approval</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-500">Desktop control</span>
                <span className="text-gray-400 dark:text-gray-600">separate mode</span>
              </div>
            </div>
          </section>

          <section className="border-t border-gray-100 pt-5 dark:border-surface-divider">
            <div className="mb-3 flex items-center gap-2">
              <GearSix size={14} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Build notes</p>
            </div>
            <p className="text-xs leading-relaxed text-gray-400 dark:text-gray-600">
              This page uses existing KB, memory, workflow APIs, and a local artifact lab for previewing universal artifact payloads. Project maps, permissions, and real agent execution can be wired in as those backend surfaces land.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};
