import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Collapse, Delete, Error, Pause, Play, Reject, Spinner, Success } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Input } from "@/ui/primitives/Input";
import { Select } from "@/ui/primitives/Select";
import { Textarea } from "@/ui/primitives/Textarea";
import {
  listRuns,
  type AgentRun,
  type AgentType,
  type CreateAgentDraft,
  type TriggerType,
  type UserAgent,
} from "@/features/workspace/services/agentWorkflowService";
import { formatRelative } from "./workspaceFormat";

const AGENT_TYPE_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "omni", label: "Omni" },
  { value: "coding", label: "Coding" },
];

const TRIGGER_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "cron", label: "Scheduled" },
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

function RoutineActionButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="primary"
      disabled={disabled}
      className="inline-flex gap-1.5 rounded-md bg-primary px-3 py-1.5 h-auto text-xs font-medium text-on-emphasis transition-colors duration-150 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </Button>
  );
}

export function CreateAgentForm({
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
          <RoutineActionButton disabled={saving}>
            {saving && <Spinner size="sm" className="animate-spin" />}
            Save routine
          </RoutineActionButton>
        </div>
      </div>
    </form>
  );
}

export function AgentRow({
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
