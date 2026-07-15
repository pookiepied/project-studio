import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Icon,
  type PhosphorIcon,
  Add,
  Brain,
  Checklist,
  Collapse,
  Document,
  Error,
  FolderOpen,
  Lightning,
  Project,
  ShieldCheck,
  Spinner,
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
  runAgent,
  type CreateAgentDraft,
  type UserAgent,
} from "@/features/workspace/services/agentWorkflowService";
import { AgentRow, CreateAgentForm } from "./WorkspaceAutomation";
import { DocumentList, MemoryList } from "./WorkspaceContextLists";
import { CATEGORY_LABELS, formatBytes, formatRelative } from "./workspaceFormat";

type WorkspaceSection = "overview" | "context" | "automation" | "activity";

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
  { id: "context", label: "Context", icon: Database, hint: "Docs and memory" },
  { id: "automation", label: "Automation", icon: Robot, hint: "Agents and routines" },
  { id: "activity", label: "Activity", icon: Graph, hint: "Workspace events" },
];

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
                    </div>
                  </section>
                </div>
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
