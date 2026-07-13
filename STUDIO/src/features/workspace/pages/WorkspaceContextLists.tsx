import { useMemo } from "react";
import {
  BrainIcon,
  Delete,
  Document,
  FileTextIcon,
  Icon,
  Spinner,
  TagIcon,
} from "@/ui/icons";
import { EmptyState } from "@/ui/primitives/EmptyState";
import { IconButton } from "@/ui/primitives/IconButton";
import type { KbDocument, MemoryFact } from "@/features/chat/attachments/kbService";
import { CATEGORY_LABELS, formatBytes, formatDate } from "./workspaceFormat";

export function DocumentList({
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
        icon={FileTextIcon}
        title="No documents yet"
        body="Add project notes, specs, research, or JSON context that should survive across conversations."
      />
    );
  }

  return (
    <ul className="divide-y divide-surface-divider">
      {docs.map((doc) => (
        <li key={doc.id} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-surface-base">
            <Document size="sm" className="text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-primary" title={doc.name}>{doc.name}</p>
            <p className="mt-0.5 text-xs text-disabled">
              {formatBytes(doc.size)} - {doc.chunkCount} chunks - {formatDate(doc.createdAt)}
              {doc.truncated && <span className="ml-1.5 text-secondary">truncated</span>}
            </p>
          </div>
          <IconButton
            aria-label="Delete document"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(doc.id, doc.size)}
            disabled={deletingDocId === doc.id}
            className="flex-shrink-0 rounded-md text-disabled opacity-0 transition-all hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100 dark:opacity-100 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
          >
            {deletingDocId === doc.id ? <Spinner size="sm" className="animate-spin" /> : <Delete size="sm" />}
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

export function MemoryList({
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
        icon={BrainIcon}
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
            <span className="text-2xs font-semibold uppercase tracking-extra-wide text-disabled">
              {CATEGORY_LABELS[cat] ?? cat}
            </span>
          </div>
          <ul>
            {grouped[cat].map((fact) => (
              <li key={fact.key} className="group flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-surface-hover">
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed text-secondary">{fact.content}</p>
                  {fact.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Icon icon={TagIcon} size="xs" className="text-disabled" />
                      {fact.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded bg-surface-base px-1.5 py-0.5 text-2xs text-disabled">{tag}</span>
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
                  <IconButton
                    aria-label="Delete memory"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(fact.key)}
                    disabled={deletingFactId === fact.key}
                    className="rounded-md text-disabled opacity-0 transition-all hover:bg-surface-raised hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100 dark:opacity-100 dark:hover:bg-surface-raised/30 dark:hover:text-secondary"
                  >
                    {deletingFactId === fact.key ? <Spinner size="sm" className="animate-spin" /> : <Delete size="sm" />}
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
