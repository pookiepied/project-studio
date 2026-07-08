import { CheckCircleIcon as CheckCircle, ClockIcon as Clock, WarningCircleIcon as WarningCircle, XCircleIcon as XCircle, ArrowSquareOutIcon as ArrowSquareOut } from "@phosphor-icons/react";
import type {
  Artifact,
  ArtifactAction,
  ArtifactFileChange,
  ArtifactLink,
  ArtifactListItem,
  ArtifactSection,
  ArtifactStat,
  ArtifactTimelineItem,
} from "@/types/artifacts";
import { parseArtifact } from "@/utils/artifact";
import { JsonRenderer } from "./JsonRenderer";
import { WebSearchArtifact } from "./artifacts";

interface ArtifactRendererProps {
  code: string;
}

function statusTone(status: Artifact["status"]) {
  switch (status) {
    case "success":
      return {
        icon: <CheckCircle size={14} weight="fill" className="text-secondary" />,
        label: "Success",
        pill: "bg-surface-raised text-secondary border-surface-border dark:bg-surface-raised/20 dark:text-secondary dark:border-surface-border/40",
      };
    case "partial":
      return {
        icon: <WarningCircle size={14} weight="fill" className="text-secondary" />,
        label: "Partial",
        pill: "bg-surface-raised text-secondary border-surface-border dark:bg-surface-raised/20 dark:text-secondary dark:border-surface-border/40",
      };
    case "error":
      return {
        icon: <XCircle size={14} weight="fill" className="text-secondary" />,
        label: "Error",
        pill: "bg-surface-raised text-secondary border-surface-border dark:bg-surface-raised/20 dark:text-secondary dark:border-surface-border/40",
      };
    case "pending":
    default:
      return {
        icon: <Clock size={14} weight="fill" className="text-secondary" />,
        label: "Pending",
        pill: "bg-surface-raised text-secondary border-surface-border dark:bg-surface-raised/20 dark:text-secondary dark:border-surface-border/40",
      };
  }
}

function renderPrimitive(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function ArtifactActionLink({ action }: { action: ArtifactAction }) {
  if (!action.href) return null;
  return (
    <a
      href={action.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-surface-border text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-raised transition-colors"
    >
      <span>{action.label}</span>
      <ArrowSquareOut size={12} weight="bold" />
    </a>
  );
}

function ArtifactStats({ items }: { items: ArtifactStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-gray-200 dark:border-surface-border px-3 py-2 bg-gray-50/80 dark:bg-surface-base/60">
          <div className="text-2xs uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">{item.label}</div>
          <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{renderPrimitive(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ArtifactList({ items }: { items: ArtifactListItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const label = item.label?.trim();
        const value = renderPrimitive(item.value);
        return (
          <div key={`${label ?? "item"}-${index}`} className="rounded-xl border border-gray-200 dark:border-surface-border px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {label && <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>}
                {item.description && <div className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{item.description}</div>}
              </div>
              {(item.value !== undefined || item.href || item.status) && (
                <div className="text-xs text-gray-600 dark:text-gray-300 text-right break-all">
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-secondary dark:text-secondary hover:underline">
                      {label ? "Open" : item.href}
                    </a>
                  ) : item.status ? item.status : value}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArtifactLinks({ items }: { items: ArtifactLink[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <a
          key={`${item.label}-${item.href}`}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-gray-200 dark:border-surface-border px-3 py-2 hover:bg-gray-50 dark:hover:bg-surface-raised transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-secondary dark:text-secondary truncate">{item.label}</div>
              {item.description && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{item.description}</div>}
            </div>
            <ArrowSquareOut size={12} weight="bold" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          </div>
        </a>
      ))}
    </div>
  );
}

function ArtifactTable({ section }: { section: Extract<ArtifactSection, { type: "table" }> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-surface-border">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 dark:bg-surface-base/80">
          <tr>
            {section.table.columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-gray-200 dark:border-surface-border">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-gray-700 dark:text-gray-300 align-top">
                  {renderPrimitive(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtifactTimeline({ items }: { items: ArtifactTimelineItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="flex gap-3">
          <div className="mt-1 h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.label}</div>
            {(item.time || item.status) && (
              <div className="mt-0.5 text-2xs uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
                {[item.time, item.status].filter(Boolean).join(" / ")}
              </div>
            )}
            {item.description && <div className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{item.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactFileChanges({ items }: { items: ArtifactFileChange[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.path} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-surface-border px-3 py-2 text-xs">
          <span className="truncate text-gray-700 dark:text-gray-300">{item.path}</span>
          <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
            {[item.action, item.additions !== undefined ? `+${item.additions}` : null, item.deletions !== undefined ? `-${item.deletions}` : null]
              .filter(Boolean)
              .join(" ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function ArtifactSectionView({ section }: { section: ArtifactSection }) {
  return (
    <div className="space-y-2">
      {section.title && <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">{section.title}</div>}
      {section.type === "text" && (
        <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{section.content}</div>
      )}
      {section.type === "stats" && <ArtifactStats items={section.items} />}
      {section.type === "kv" && <ArtifactList items={section.items} />}
      {section.type === "list" && <ArtifactList items={section.items} />}
      {section.type === "links" && <ArtifactLinks items={section.items} />}
      {section.type === "table" && <ArtifactTable section={section} />}
      {section.type === "timeline" && <ArtifactTimeline items={section.items} />}
      {section.type === "file_changes" && <ArtifactFileChanges items={section.items} />}
      {section.type === "json" && <JsonRenderer code={JSON.stringify(section.data, null, 2)} />}
    </div>
  );
}

function GenericArtifactFallback({ artifact }: { artifact: Artifact }) {
  if (artifact.data === undefined) return null;
  return <JsonRenderer code={JSON.stringify(artifact.data, null, 2)} />;
}

export function ArtifactRenderer({ code }: ArtifactRendererProps) {
  const { artifact, error } = parseArtifact(code);

  if (!artifact) {
    return (
      <div className="px-4 py-3 text-xs font-mono text-gray-400 dark:text-gray-500 whitespace-pre-wrap break-all leading-relaxed">
        {error ? `${error}\n\n${code}` : code}
      </div>
    );
  }

  if (artifact.kind === "web_search") {
    return <WebSearchArtifact artifact={artifact} />;
  }

  const tone = statusTone(artifact.status ?? "success");
  const sourceParts = [artifact.source?.app, artifact.source?.server, artifact.source?.tool].filter(Boolean);
  const category = artifact.category ?? "general";

  return (
    <div className="px-4 py-4 space-y-4 bg-white dark:bg-surface-base">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{artifact.title}</h3>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${tone.pill}`}>
              {tone.icon}
              <span>{tone.label}</span>
            </span>
            <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-surface-border px-2 py-0.5 text-2xs font-medium text-gray-500 dark:text-gray-400">
              {category} / {artifact.kind}
            </span>
          </div>
          {artifact.summary && <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{artifact.summary}</p>}
          {artifact.presentation?.compactLabel && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{artifact.presentation.compactLabel}</p>
          )}
          {sourceParts.length > 0 && (
            <p className="mt-2 text-2xs uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
              {sourceParts.join(" / ")}
            </p>
          )}
        </div>

        {artifact.primaryAction?.href && <ArtifactActionLink action={artifact.primaryAction} />}
      </div>

      {artifact.stats && artifact.stats.length > 0 && <ArtifactStats items={artifact.stats} />}

      {artifact.sections && artifact.sections.length > 0 ? (
        <div className="space-y-4">
          {artifact.sections.map((section, index) => (
            <ArtifactSectionView key={`${section.type}-${index}`} section={section} />
          ))}
        </div>
      ) : (
        <GenericArtifactFallback artifact={artifact} />
      )}

      {artifact.actions && artifact.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {artifact.actions.map((action) => (
            <ArtifactActionLink key={`${action.label}-${action.href ?? "action"}`} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}
