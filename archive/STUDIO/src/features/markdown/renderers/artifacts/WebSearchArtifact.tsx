import { ExternalLink as ExternalLinkIcon, Search, Clock, Success } from "@/ui/icons";
import type { Artifact, ArtifactLink, ArtifactListItem, ArtifactTimelineItem } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

function getDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function FaviconInitial({ href }: { href: string }) {
  const domain = getDomain(href);
  const initial = domain.charAt(0).toUpperCase();
  return (
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-base text-2xs font-semibold text-muted dark:bg-white/[0.07] dark:text-disabled">
      {initial}
    </div>
  );
}

function ResultRow({ item }: { item: ArtifactLink }) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-surface-base/70 dark:hover:bg-white/[0.04]"
    >
      <FaviconInitial href={item.href} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary transition-colors group-hover:text-secondary dark:text-primary dark:group-hover:text-secondary">
          {item.label}
        </div>
        <div className="mt-0.5 truncate text-2xs text-disabled dark:text-muted">
          {getDomain(item.href)}
        </div>
        {item.description && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">
            {item.description}
          </div>
        )}
      </div>
      <ExternalLinkIcon
        size="xs"
        className="mt-0.5 flex-shrink-0 text-disabled transition-colors group-hover:text-secondary dark:text-secondary"
      />
    </a>
  );
}

function modeLabel(artifact: Artifact): string {
  const mode = artifact.meta?.mode;
  if (mode === "fetch") return "Fetching sources";
  if (mode === "complete") return "Research complete";
  return "Searching web";
}

function statusIcon(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") {
    return <Success size="sm" className="text-secondary dark:text-disabled" />;
  }
  if (artifact.status === "loading" || artifact.status === "streaming" || artifact.status === "pending") {
    return <Clock size="sm" className="text-secondary dark:text-disabled" />;
  }
  return <Search size="sm" className="text-secondary dark:text-disabled" />;
}

function statusDot(status: ArtifactTimelineItem["status"]) {
  if (status === "completed" || status === "success") return "bg-secondary";
  if (status === "streaming" || status === "loading") return "bg-primary animate-pulse";
  if (status === "failed" || status === "error") return "bg-secondary";
  return "bg-surface-selected dark:bg-surface-border";
}

function ProgressList({ artifact }: { artifact: Artifact }) {
  const timeline = artifact.sections?.find((section) => section.type === "timeline");
  const items: ArtifactTimelineItem[] = timeline?.type === "timeline" ? timeline.items : [];
  if (!items.length) return null;

  return (
    <div className="mt-3">
      <AnimatedList className="space-y-1.5">
        {items.map((item, index) => (
          <AnimatedItem key={`${item.label}-${index}`} className="flex items-start gap-2.5">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${statusDot(item.status)}`} />
            <div className="min-w-0">
              <div className="text-xs text-secondary dark:text-disabled">
                {item.label}
                {(item.status === "loading" || item.status === "streaming") && <span className="ml-1"><ProcessingDots /></span>}
              </div>
              {item.description && (
                <div className="mt-0.5 text-2xs leading-relaxed text-muted dark:text-muted">
                  {item.description}
                </div>
              )}
            </div>
          </AnimatedItem>
        ))}
      </AnimatedList>
    </div>
  );
}

export function WebSearchArtifact({ artifact }: Props) {
  const linksSection = artifact.sections?.find((s) => s.type === "links");
  const results: ArtifactLink[] = linksSection?.type === "links" ? linksSection.items : [];
  const listSection = artifact.sections?.find((s) => s.type === "list");
  const takeaways: ArtifactListItem[] = listSection?.type === "list" ? listSection.items : [];
  const query =
    (artifact.meta?.query as string | undefined) ??
    artifact.title.replace(/^Search:\s*/i, "");
  const working = isArtifactWorking(artifact.status);

  return (
    <ArtifactShell working={working}>
      <div className="flex items-start gap-3">
        <ArtifactIconBubble working={working}>
          {statusIcon(artifact)}
        </ArtifactIconBubble>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">
            {query}
          </div>
          <div className="mt-0.5 text-2xs text-disabled dark:text-muted">
            {modeLabel(artifact)} / {results.length} source{results.length !== 1 ? "s" : ""}
          </div>
          {artifact.summary && (
            <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
              {artifact.summary}
            </p>
          )}
        </div>
      </div>

      <AnimatedList className="mt-3">
        {results.length > 0 ? (
          results.map((item, i) => (
            <AnimatedItem key={`${item.href}-${i}`}>
              <ResultRow item={item} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="rounded-xl bg-surface-page/60 px-3 py-3 text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
            Sources will appear here as search results arrive. {working && <ProcessingDots />}
          </AnimatedItem>
        )}
      </AnimatedList>

      {takeaways.length > 0 && (
        <AnimatedList className="mt-3 space-y-1.5">
          {takeaways.map((item, index) => (
            <AnimatedItem key={`${item.label ?? "takeaway"}-${index}`} className="text-xs leading-relaxed text-secondary dark:text-disabled">
              {item.label && <span className="font-medium text-primary dark:text-primary">{item.label}: </span>}
              {item.description ?? item.value}
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      <ProgressList artifact={artifact} />

      <div className="mt-3 text-2xs text-disabled dark:text-muted">
        Web research / Studio
      </div>
    </ArtifactShell>
  );
}
