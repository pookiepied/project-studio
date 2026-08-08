import { Checklist, Clock, Edit, Search, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type TaskItem = {
  id: string;
  title: string;
  project?: string;
  section?: string;
  due?: string;
  assignee?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "open" | "in_progress" | "completed" | "cancelled";
  labels?: string[];
  description?: string;
};

type TaskDraft = {
  title: string;
  project?: string;
  due?: string;
  assignee?: string;
  labels?: string[];
  description?: string;
};

type TaskAction = {
  action: "create" | "update" | "complete" | "delete" | "schedule" | "assign";
  target?: string;
  result?: string;
};

type TaskArtifactData = {
  provider?: string;
  query?: string;
  tasks?: TaskItem[];
  task?: TaskItem;
  draft?: TaskDraft;
  action?: TaskAction;
};

function taskData(artifact: Artifact): TaskArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as TaskArtifactData;
}

function providerLabel(artifact: Artifact, data: TaskArtifactData) {
  const source = (data.provider ?? artifact.source?.app ?? artifact.kind).toLowerCase();
  if (source.includes("asana")) return "Asana";
  if (source.includes("linear")) return "Linear";
  if (source.includes("jira")) return "Jira";
  if (source.includes("trello")) return "Trello";
  if (source.includes("clickup")) return "ClickUp";
  return "Todoist";
}

function statusLabel(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") return "Completed";
  if (artifact.status === "failed" || artifact.status === "error") return "Failed";
  if (artifact.status === "loading" || artifact.status === "streaming") return "Working";
  return "Pending";
}

function Header({ artifact, data, icon, meta }: { artifact: Artifact; data: TaskArtifactData; icon: React.ReactNode; meta?: string }) {
  const working = isArtifactWorking(artifact.status);
  return (
    <div className="flex items-start gap-3">
      <ArtifactIconBubble working={working}>{icon}</ArtifactIconBubble>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">{artifact.title}</div>
        <div className="mt-0.5 text-2xs text-disabled dark:text-muted">{providerLabel(artifact, data)} / {statusLabel(artifact)}{meta ? ` / ${meta}` : ""}</div>
        {artifact.summary && <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">{artifact.summary}</p>}
      </div>
    </div>
  );
}

function priorityClass(priority?: TaskItem["priority"]) {
  if (priority === "urgent" || priority === "high") return "bg-primary";
  if (priority === "medium") return "bg-secondary";
  return "bg-surface-selected dark:bg-surface-border";
}

function TaskRow({ task }: { task: TaskItem }) {
  const completed = task.status === "completed";
  return (
    <div className="group flex items-start gap-3 rounded-2xl px-1.5 py-2.5 transition-colors hover:bg-surface-page/70 dark:hover:bg-white/[0.04]">
      <span className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${completed ? "border-secondary bg-secondary" : "border-surface-border dark:border-surface-border"}`}>
        {completed && <Success size="xs" className="text-on-emphasis" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">{task.title}</div>
          {task.due && <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{task.due}</div>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted dark:text-disabled">
          {[task.project, task.section, task.assignee].filter(Boolean).join(" / ")}
        </div>
        {task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">{task.description}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.priority && <span className={`h-2 w-2 rounded-full ${priorityClass(task.priority)}`} />}
          {task.labels?.map((label) => (
            <span key={label} className="rounded-full bg-surface-page/70 px-2 py-0.5 text-2xs text-muted dark:bg-white/[0.045] dark:text-muted">{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskList({ artifact, data }: { artifact: Artifact; data: TaskArtifactData }) {
  const tasks = data.tasks ?? [];
  const working = isArtifactWorking(artifact.status);
  return (
    <ArtifactShell working={working}>
      <Header artifact={artifact} data={data} icon={<Search size="sm" className="text-secondary dark:text-disabled" />} meta={data.query} />
      <AnimatedList className="mt-3">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <AnimatedItem key={task.id}>
              <TaskRow task={task} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
            {working ? <>Tasks will appear here as the connector responds. <ProcessingDots /></> : "No matching tasks found."}
          </AnimatedItem>
        )}
      </AnimatedList>
      <Footer text={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`} />
    </ArtifactShell>
  );
}

function TaskDraftView({ artifact, data }: { artifact: Artifact; data: TaskArtifactData }) {
  const draft = data.draft;
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} data={data} icon={<Edit size="sm" className="text-secondary dark:text-disabled" />} meta="Draft" />
      {draft ? (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
          <div className="text-sm font-medium text-primary dark:text-primary">{draft.title}</div>
          <div className="mt-1 text-xs text-muted dark:text-disabled">{[draft.project, draft.due, draft.assignee].filter(Boolean).join(" / ")}</div>
          {draft.description && <p className="mt-3 text-sm leading-relaxed text-secondary dark:text-disabled">{draft.description}</p>}
        </AnimatedItem>
      ) : (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
          Task draft will appear here.
        </AnimatedItem>
      )}
      <Footer text="Task draft" />
    </ArtifactShell>
  );
}

function TaskActionView({ artifact, data }: { artifact: Artifact; data: TaskArtifactData }) {
  const action = data.action;
  const failed = artifact.status === "failed" || artifact.status === "error" || artifact.status === "rejected";
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        data={data}
        icon={failed ? <Warning size="sm" className="text-secondary dark:text-disabled" /> : <Checklist size="sm" className="text-secondary dark:text-disabled" />}
        meta={action?.action}
      />
      <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
        <div className="text-sm font-medium text-primary dark:text-primary">{action?.target ?? artifact.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
          {action?.result ?? artifact.summary ?? "Task action is waiting for a result."}
        </p>
      </AnimatedItem>
      <Footer text="Task action" />
    </ArtifactShell>
  );
}

function Footer({ text }: { text: string }) {
  return <div className="mt-3 flex items-center gap-1.5 text-2xs text-disabled dark:text-muted"><Clock size="xs" /><span>{text} / Studio</span></div>;
}

export function TaskArtifact({ artifact }: Props) {
  const data = taskData(artifact);
  if (artifact.kind.endsWith("_draft")) return <TaskDraftView artifact={artifact} data={data} />;
  if (artifact.kind.endsWith("_action")) return <TaskActionView artifact={artifact} data={data} />;
  return <TaskList artifact={artifact} data={data} />;
}
