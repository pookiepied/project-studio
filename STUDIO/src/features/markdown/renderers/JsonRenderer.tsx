import { useState, useMemo } from "react";
import { Collapse, Expand } from "@/ui/icons";

interface JsonRendererProps {
  code: string;
}

interface JsonNodeProps {
  data: unknown;
  depth?: number;
  keyName?: string | number;
  isLast?: boolean;
}

function JsonNode({ data, depth = 0, keyName, isLast = true }: JsonNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const indent = depth * 16;

  const keyLabel = keyName !== undefined ? (
    <span className="text-secondary dark:text-secondary">
      {typeof keyName === "string" ? `"${keyName}"` : keyName}
    </span>
  ) : null;

  const colon = keyLabel ? <span className="text-gray-500 dark:text-gray-500">: </span> : null;
  const comma = !isLast ? <span className="text-gray-400 dark:text-gray-600">,</span> : null;

  if (data === null) {
    return (
      <div style={{ paddingLeft: indent }} className="leading-5">
        {keyLabel}{colon}<span className="text-gray-400 dark:text-gray-500">null</span>{comma}
      </div>
    );
  }

  if (typeof data === "boolean") {
    return (
      <div style={{ paddingLeft: indent }} className="leading-5">
        {keyLabel}{colon}<span className="text-secondary dark:text-secondary">{String(data)}</span>{comma}
      </div>
    );
  }

  if (typeof data === "number") {
    return (
      <div style={{ paddingLeft: indent }} className="leading-5">
        {keyLabel}{colon}<span className="text-secondary dark:text-secondary">{data}</span>{comma}
      </div>
    );
  }

  if (typeof data === "string") {
    return (
      <div style={{ paddingLeft: indent }} className="leading-5 break-all">
        {keyLabel}{colon}<span className="text-secondary dark:text-secondary">"{data}"</span>{comma}
      </div>
    );
  }

  if (Array.isArray(data)) {
    const isEmpty = data.length === 0;
    return (
      <div style={{ paddingLeft: indent }}>
        <div
          className="flex items-center gap-0.5 cursor-pointer select-none leading-5 hover:bg-gray-100 dark:hover:bg-surface-raised rounded"
          onClick={() => !isEmpty && setOpen((o) => !o)}
        >
          {!isEmpty && (
            open
              ? <Expand size="xs" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              : <Collapse size="xs" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          )}
          {keyLabel}{colon}
          <span className="text-gray-500 dark:text-gray-400">{"["}</span>
          {!open && <span className="text-gray-400 dark:text-gray-600 text-2xs ml-1">{data.length} items</span>}
          {(isEmpty || !open) && <span className="text-gray-500 dark:text-gray-400">{"]"}</span>}
          {(isEmpty || !open) && comma}
        </div>
        {open && !isEmpty && (
          <div>
            {data.map((item, i) => (
              <JsonNode key={i} data={item} depth={depth + 1} keyName={i} isLast={i === data.length - 1} />
            ))}
            <div style={{ paddingLeft: 0 }} className="leading-5">
              <span className="text-gray-500 dark:text-gray-400">{"]"}</span>{comma}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const isEmpty = entries.length === 0;
    return (
      <div style={{ paddingLeft: indent }}>
        <div
          className="flex items-center gap-0.5 cursor-pointer select-none leading-5 hover:bg-gray-100 dark:hover:bg-surface-raised rounded"
          onClick={() => !isEmpty && setOpen((o) => !o)}
        >
          {!isEmpty && (
            open
              ? <Expand size="xs" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              : <Collapse size="xs" className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          )}
          {keyLabel}{colon}
          <span className="text-gray-500 dark:text-gray-400">{"{"}</span>
          {!open && <span className="text-gray-400 dark:text-gray-600 text-2xs ml-1">{entries.length} keys</span>}
          {(isEmpty || !open) && <span className="text-gray-500 dark:text-gray-400">{"}"}</span>}
          {(isEmpty || !open) && comma}
        </div>
        {open && !isEmpty && (
          <div>
            {entries.map(([k, v], i) => (
              <JsonNode key={k} data={v} depth={depth + 1} keyName={k} isLast={i === entries.length - 1} />
            ))}
            <div style={{ paddingLeft: 0 }} className="leading-5">
              <span className="text-gray-500 dark:text-gray-400">{"}"}</span>{comma}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export function JsonRenderer({ code }: JsonRendererProps) {
  const { parsed, error } = useMemo(() => {
    try {
      return { parsed: JSON.parse(code.trim()), error: null };
    } catch (e: any) {
      return { parsed: null, error: e?.message ?? "Invalid JSON" };
    }
  }, [code]);

  if (error) {
    // JSON is likely still streaming — show raw text as a neutral fallback
    return (
      <div className="px-4 py-3 text-xs font-mono text-gray-400 dark:text-gray-500 whitespace-pre-wrap break-all leading-relaxed">
        {code}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 text-xs font-mono overflow-x-auto text-gray-700 dark:text-gray-300">
      <JsonNode data={parsed} />
    </div>
  );
}
