import { GitBranchIcon, GithubLogoIcon, Icon, Search, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type GithubItem = {
  id: string;
  number?: number;
  title: string;
  repo?: string;
  author?: string;
  state?: "open" | "closed" | "merged" | "draft" | "queued" | "success" | "failure";
  type?: "issue" | "pull_request" | "workflow" | "repository" | "commit";
  branch?: string;
  updatedAt?: string;
  labels?: string[];
  description?: string;
  url?: string;
};

type GithubAction = {
  action: "comment" | "merge" | "close" | "open" | "assign" | "label" | "rerun" | "create_issue" | "create_pr";
  target?: string;
  result?: string;
};

type GithubArtifactData = {
  query?: string;
  repo?: string;
  items?: GithubItem[];
  item?: GithubItem;
  action?: GithubAction;
};

function githubData(artifact: Artifact): GithubArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as GithubArtifactData;
}

function statusLabel(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") return "Completed";
  if (artifact.status === "failed" || artifact.status === "error") return "Failed";
  if (artifact.status === "loading" || artifact.status === "streaming") return "Working";
  return "Pending";
}

function Header({ artifact, icon, meta }: { artifact: Artifact; icon: React.ReactNode; meta?: string }) {
  const working = isArtifactWorking(artifact.status);
  return (
    <div className="flex items-start gap-3">
      <ArtifactIconBubble working={working}>{icon}</ArtifactIconBubble>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">{artifact.title}</div>
        <div className="mt-0.5 text-2xs text-disabled dark:text-muted">GitHub / {statusLabel(artifact)}{meta ? ` / ${meta}` : ""}</div>
        {artifact.summary && <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">{artifact.summary}</p>}
      </div>
    </div>
  );
}

function stateClass(state?: GithubItem["state"]) {
  if (state === "open" || state === "success") return "bg-secondary";
  if (state === "merged") return "bg-primary";
  if (state === "failure") return "bg-muted";
  return "bg-surface-selected dark:bg-surface-border";
}

function ItemRow({ item }: { item: GithubItem }) {
  return (
    <div className="group flex gap-3 rounded-2xl px-1.5 py-2.5 transition-colors hover:bg-surface-page/70 dark:hover:bg-white/[0.04]">
      <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${stateClass(item.state)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">
            {item.number ? `#${item.number} ` : ""}{item.title}
          </div>
          {item.updatedAt && <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{item.updatedAt}</div>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted dark:text-disabled">
          {[item.repo, item.branch, item.author].filter(Boolean).join(" / ")}
        </div>
        {item.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">{item.description}</p>}
        {item.labels?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.labels.map((label) => (
              <span key={label} className="rounded-full bg-surface-page/70 px-2 py-0.5 text-2xs text-muted dark:bg-white/[0.045] dark:text-muted">{label}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GithubList({ artifact, data }: { artifact: Artifact; data: GithubArtifactData }) {
  const items = data.items ?? [];
  const working = isArtifactWorking(artifact.status);
  return (
    <ArtifactShell working={working}>
      <Header artifact={artifact} icon={<Search size="sm" className="text-secondary dark:text-disabled" />} meta={data.repo} />
      {data.query && <div className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-2 text-xs text-muted dark:bg-white/[0.035] dark:text-muted">Search: {data.query}</div>}
      <AnimatedList className="mt-2">
        {items.length > 0 ? (
          items.map((item) => (
            <AnimatedItem key={item.id}>
              <ItemRow item={item} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
            {working ? <>GitHub results will appear here. <ProcessingDots /></> : "No GitHub results found."}
          </AnimatedItem>
        )}
      </AnimatedList>
      <Footer text={`${items.length} result${items.length === 1 ? "" : "s"}`} />
    </ArtifactShell>
  );
}

function GithubDetail({ artifact, data }: { artifact: Artifact; data: GithubArtifactData }) {
  const item = data.item ?? data.items?.[0];
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} icon={<Icon icon={GithubLogoIcon} size="sm" weight="fill" className="text-secondary dark:text-disabled" />} meta={item?.repo} />
      {item ? (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
          <div className="flex items-start gap-3">
            <Icon icon={GitBranchIcon} size="md" className="mt-0.5 flex-shrink-0 text-secondary dark:text-disabled" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-primary dark:text-primary">{item.number ? `#${item.number} ` : ""}{item.title}</div>
              <div className="mt-1 text-xs text-muted dark:text-disabled">{[item.repo, item.state, item.author].filter(Boolean).join(" / ")}</div>
              {item.description && <p className="mt-3 text-sm leading-relaxed text-secondary dark:text-disabled">{item.description}</p>}
            </div>
          </div>
        </AnimatedItem>
      ) : (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
          GitHub details will appear here.
        </AnimatedItem>
      )}
      <Footer text="GitHub detail" />
    </ArtifactShell>
  );
}

function GithubActionView({ artifact, data }: { artifact: Artifact; data: GithubArtifactData }) {
  const action = data.action;
  const failed = artifact.status === "failed" || artifact.status === "error" || artifact.status === "rejected";
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        icon={failed ? <Warning size="sm" className="text-secondary dark:text-disabled" /> : <Success size="sm" className="text-secondary dark:text-disabled" />}
        meta={action?.action}
      />
      <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
        <div className="text-sm font-medium text-primary dark:text-primary">{action?.target ?? artifact.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
          {action?.result ?? artifact.summary ?? "GitHub action is waiting for a result."}
        </p>
      </AnimatedItem>
      <Footer text="GitHub action" />
    </ArtifactShell>
  );
}

function Footer({ text }: { text: string }) {
  return <div className="mt-3 text-2xs text-disabled dark:text-muted">{text} / Studio</div>;
}

export function GithubArtifact({ artifact }: Props) {
  const data = githubData(artifact);
  if (artifact.kind === "github_issue" || artifact.kind === "github_pull_request" || artifact.kind === "github_repository" || artifact.kind === "github_workflow") {
    return <GithubDetail artifact={artifact} data={data} />;
  }
  if (artifact.kind === "github_action") return <GithubActionView artifact={artifact} data={data} />;
  return <GithubList artifact={artifact} data={data} />;
}
