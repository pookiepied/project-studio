import { Warning } from "@/components/icons";

// ---------------------------------------------------------------------------
// Status indicator — strict-neutral (D-401): no hue. State reads on the
// shade + icon channels: healthy = strong (near-black) dot, degraded = faint
// (muted) dot, down/error = a Warning glyph. §11.3 (icon + weight + surface).
// ---------------------------------------------------------------------------

type StatusTone = "strong" | "soft" | "alert";

function statusTone(status: string): StatusTone {
  if (status === "operational" || status === "ok" || status === "healthy") return "strong";
  if (status === "degraded") return "soft";
  return "alert";
}

export const StatusDot = ({ status }: { status: string }) => {
  const tone = statusTone(status);
  if (tone === "alert") {
    return <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />;
  }
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        tone === "strong" ? "bg-primary animate-pulse" : "bg-muted"
      }`}
    />
  );
};

// ---------------------------------------------------------------------------
// Health card
// ---------------------------------------------------------------------------

interface HealthCardProps {
  label: string;
  status: string;
  meta?: string;
  loading?: boolean;
}

export const HealthCard = ({ label, status, meta, loading }: HealthCardProps) => (
  <div className="rounded-lg border border-surface-border bg-surface-base px-2.5 py-2 flex items-center gap-2 transition-colors duration-normal">
    {loading ? (
      <span className="w-1.5 h-1.5 rounded-full bg-surface-active flex-shrink-0 animate-pulse" />
    ) : (
      <div><StatusDot status={status} /></div>
    )}
    <div className="min-w-0 flex-1">
      <div className="text-xs font-medium text-secondary truncate">{label}</div>
      <div className="text-2xs text-muted truncate">
        {loading ? "checking…" : (meta ?? status)}
      </div>
    </div>
  </div>
);
