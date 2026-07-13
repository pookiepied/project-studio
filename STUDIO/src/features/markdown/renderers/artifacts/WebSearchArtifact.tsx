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
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xs font-semibold text-gray-500 dark:bg-white/[0.07] dark:text-gray-400">
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
      className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
    >
      <FaviconInitial href={item.href} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900 transition-colors group-hover:text-secondary dark:text-gray-100 dark:group-hover:text-secondary">
          {item.label}
        </div>
        <div className="mt-0.5 truncate text-2xs text-gray-400 dark:text-gray-500">
          {getDomain(item.href)}
        </div>
        {item.description && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {item.description}
          </div>
        )}
      </div>
      <ExternalLinkIcon
        size="xs"
        className="mt-0.5 flex-shrink-0 text-gray-300 transition-colors group-hover:text-secondary dark:text-gray-600"
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-surface-base">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.07]">
          <Search size="sm" className="text-gray-500 dark:text-gray-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {query}
          </div>
          <div className="text-2xs text-gray-400 dark:text-gray-500">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {results.length > 0 ? (
          results.map((item, i) => <ResultRow key={`${item.href}-${i}`} item={item} />)
        ) : (
          <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
            No results found.
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5 dark:border-white/[0.06]">
        <span className="text-2xs text-gray-400 dark:text-gray-500">
          via web_search · Studio
        </span>
      </div>
    </div>
  );
}
