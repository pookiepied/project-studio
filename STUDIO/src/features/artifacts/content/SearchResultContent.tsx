import { useState } from "react";
import { GlobeIcon as Globe } from "@phosphor-icons/react";

interface SearchResult {
  title?: string;
  url?: string;
  link?: string;
  /** Tavily returns a 200-400 word extract; legacy providers return a short snippet */
  content?: string;
  snippet?: string;
  description?: string;
  score?: number;
}

interface SearchResultContentProps {
  result: unknown;
  query?: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Globe size={12} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />;
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      alt=""
      width={12}
      height={12}
      className="rounded-sm flex-shrink-0 opacity-75"
      onError={() => setFailed(true)}
    />
  );
}

function parseResults(result: unknown): SearchResult[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;

  if (Array.isArray(r.results)) return (r.results as SearchResult[]).slice(0, 6);
  if (Array.isArray(result)) return (result as SearchResult[]).slice(0, 6);
  return [];
}

function parseQuery(result: unknown, queryArg?: string): string | undefined {
  if (queryArg) return queryArg;
  const r = result as Record<string, unknown>;
  if (r && typeof r.query === "string") return r.query;
  return undefined;
}

function parseAnswer(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  if (typeof r.answer === "string" && r.answer.trim()) return r.answer.trim();
  return undefined;
}

export function SearchResultContent({ result, query }: SearchResultContentProps) {
  const results = parseResults(result);
  const q = parseQuery(result, query);
  const answer = parseAnswer(result);

  if (results.length === 0 && !answer) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No results found.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Query header */}
      {q && (
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
        </p>
      )}

      {/* Synthesized answer (Tavily) */}
      {answer && (
        <div className="px-2.5 py-2 rounded-lg bg-surface-raised dark:bg-surface-raised/20 border border-surface-border dark:border-surface-border/30">
          <p className="text-xs text-secondary dark:text-secondary leading-relaxed">
            {answer}
          </p>
        </div>
      )}

      {/* Individual results */}
      {results.map((item, i) => {
        const url = item.url || item.link || "";
        const domain = url ? getDomain(url) : null;
        // Tavily returns `content` (rich extract); fall back to legacy snippet/description
        const snippet = item.content || item.snippet || item.description || "";

        return (
          <div key={i}>
            {/* Source row */}
            {domain && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <Favicon domain={domain} />
                <span className="text-2xs text-gray-400 dark:text-gray-500 truncate">{domain}</span>
              </div>
            )}

            {/* Title */}
            {item.title && (
              url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-secondary dark:text-secondary hover:underline line-clamp-1 block leading-snug"
                >
                  {item.title}
                </a>
              ) : (
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 line-clamp-1 leading-snug">
                  {item.title}
                </p>
              )
            )}

            {/* Content extract — Tavily gives 200-400 words; clamp to 3 lines */}
            {snippet && (
              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed mt-0.5">
                {snippet}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
