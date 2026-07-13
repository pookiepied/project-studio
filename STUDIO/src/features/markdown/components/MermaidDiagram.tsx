import { useEffect, useRef, useState, Component, ReactNode } from "react";
import { FONT_SANS } from "@/design/fonts";
import mermaid from "mermaid";
import { useSettings } from "@/app/contexts/SettingsContext";
import { isResolvedDark } from "@/lib/theme";

interface MermaidDiagramProps {
  code: string;
}

// ── Error boundary so a mermaid crash never breaks the parent page ──────────
interface BoundaryState { crashed: boolean; message: string }
class MermaidErrorBoundary extends Component<{ children: ReactNode; code: string }, BoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { crashed: false, message: "" };
  }
  static getDerivedStateFromError(err: any): BoundaryState {
    return { crashed: true, message: err?.message ?? "Diagram crashed" };
  }
  render() {
    if (this.state.crashed) {
      return <DiagramError code={this.props.code} />;
    }
    return this.props.children;
  }
}

function DiagramError({ code }: { code: string }) {
  return (
    <div className="px-4 py-3 space-y-1.5">
      <p className="text-xs text-secondary dark:text-secondary font-medium">
        Diagram syntax error — model produced invalid mermaid
      </p>
      <pre className="text-xs text-disabled dark:text-muted font-mono whitespace-pre-wrap">{code}</pre>
    </div>
  );
}

// ── Code normalisation ───────────────────────────────────────────────────────
const VALID_DIRECTIONS = new Set(["TD", "TB", "LR", "RL", "BT"]);
const GRAPH_PREFIX = /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|sankey-beta|block-beta)\b/i;

function cleanMermaidCode(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split("\n");

  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Fix: "flowchart" alone on its own line, next line starts with direction
    // e.g. "flowchart\nTD A[Start] --> B" → "flowchart TD\nA[Start] --> B"
    if (out.length === 0 && /^(flowchart|graph)$/i.test(trimmed) && i + 1 < lines.length) {
      const nextParts = lines[i + 1].trim().split(/\s+/);
      const maybeDir = nextParts[0].toUpperCase();
      if (VALID_DIRECTIONS.has(maybeDir)) {
        out.push(`${trimmed} ${maybeDir}`);
        const rest = nextParts.slice(1).join(" ").trim();
        if (rest) out.push(rest);
        i++;
        continue;
      }
    }

    // Fix: bare direction with no graph type, e.g. "TD\nA --> B"
    if (out.length === 0 && !GRAPH_PREFIX.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      if (VALID_DIRECTIONS.has(parts[0].toUpperCase())) {
        out.push(`flowchart ${parts[0].toUpperCase()}`);
        const rest = parts.slice(1).join(" ").trim();
        if (rest) out.push(rest);
        continue;
      }
    }

    out.push(lines[i]);
  }

  return out.join("\n").trim();
}

const ERROR_MARKERS = ["Syntax error", "Parse error", "mermaid-error", "error-icon", 'class="error"'];
function svgHasError(svg: string) {
  return ERROR_MARKERS.some((m) => svg.includes(m));
}

let counter = 0;

// ── Inner renderer ───────────────────────────────────────────────────────────
function MermaidInner({ code }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { settings } = useSettings();
  const isDark = isResolvedDark(settings.theme);

  // Reset error visibility whenever code changes (new streaming chunk)
  useEffect(() => {
    setShowError(false);
    setError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, [code]);

  useEffect(() => {
    if (!containerRef.current) return;

    const id = `mermaid-r${++counter}`;
    const cleaned = cleanMermaidCode(code);

    // Always remove any stray mermaid elements from document.body
    const domCleanup = () => {
      try {
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        // Belt-and-suspenders: remove any mermaid render artifacts left in body
        document.body
          .querySelectorAll('[id^="mermaid-r"]')
          .forEach((el) => el.remove());
      } catch {
        /* ignore cleanup failures */
      }
    };

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "neutral",
      securityLevel: "strict",
      themeVariables: isDark
        // Mermaid themeVariables — data-viz carve-out: mermaid.js themeVariables contract requires raw hex
        /* eslint-disable no-restricted-syntax */
        ? {
            background: "#181818",
            mainBkg: "#1F1F1F",
            nodeBorder: "#3A3A3A",
            lineColor: "#555555",
            textColor: "#D1D5DB",
            edgeLabelBackground: "#1F1F1F",
            clusterBkg: "#1A1A1A",
            titleColor: "#9CA3AF",
            fontFamily: FONT_SANS,
          }
        : {
            background: "#F9FAFB",
            mainBkg: "#FFFFFF",
            nodeBorder: "#D1D5DB",
            lineColor: "#9CA3AF",
            textColor: "#374151",
            edgeLabelBackground: "#FFFFFF",
            clusterBkg: "#F3F4F6",
            titleColor: "#6B7280",
            fontFamily: FONT_SANS,
          },
        /* eslint-enable no-restricted-syntax */
      flowchart: { curve: "basis", padding: 20 },
      sequence: { useMaxWidth: true },
    });

    mermaid
      .render(id, cleaned)
      .then(({ svg }) => {
        domCleanup();
        if (svgHasError(svg)) {
          setError("syntax");
          return;
        }
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          const svgEl = containerRef.current.querySelector("svg");
          if (svgEl) {
            svgEl.style.width = "100%";
            svgEl.style.height = "auto";
            svgEl.removeAttribute("height");
          }
        }
        setError(null);
        setShowError(false);
      })
      .catch(() => {
        domCleanup();
        setError("syntax");
        // Only show the error after the code has been stable for 1.5 s,
        // so incomplete diagrams during streaming stay silent.
        errorTimerRef.current = setTimeout(() => setShowError(true), 1500);
      });

    return () => {
      domCleanup();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [code, isDark]);

  if (error && showError) {
    return <DiagramError code={code} />;
  }

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center px-6 py-6 min-h-[80px] overflow-x-auto"
    />
  );
}

// ── Public export (boundary wraps renderer) ──────────────────────────────────
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  return (
    <MermaidErrorBoundary code={code}>
      <MermaidInner code={code} />
    </MermaidErrorBoundary>
  );
}
