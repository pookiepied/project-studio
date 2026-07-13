import { ExternalLink as ExternalLinkIcon, Search } from "@/ui/icons";
import type { Artifact, ArtifactLink } from "@/types/artifacts";

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
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-surface-base text-2xs font-semibold text-muted dark:bg-surface-page/[0.07] dark:text-disabled">
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
      className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-page dark:hover:bg-surface-page/[0.03]"
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
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-disabled">
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

export function WebSearchArtifact({ artifact }: Props) {
  const linksSection = artifact.sections?.find((s) => s.type === "links");
  const results: ArtifactLink[] = linksSection?.type === "links" ? linksSection.items : [];
  const query =
    (artifact.meta?.query as string | undefined) ??
    artifact.title.replace(/^Search:\s*/i, "");

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-page dark:border-white/[0.08] dark:bg-surface-base">
      <div className="flex items-center gap-2.5 border-b border-surface-border px-4 py-3 dark:border-surface-border">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-surface-base dark:bg-surface-page/[0.07]">
          <Search size="sm" className="text-muted dark:text-disabled" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">
            {query}
          </div>
          <div className="text-2xs text-disabled dark:text-muted">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="divide-y divide-surface-divider">
        {results.length > 0 ? (
          results.map((item, i) => <ResultRow key={`${item.href}-${i}`} item={item} />)
        ) : (
          <div className="px-4 py-6 text-center text-sm text-disabled dark:text-muted">
            No results found.
          </div>
        )}
      </div>

      <div className="border-t border-surface-border px-4 py-2.5 dark:border-surface-border">
        <span className="text-2xs text-disabled dark:text-muted">
          via web_search · Studio
        </span>
      </div>
    </div>
  );
}
