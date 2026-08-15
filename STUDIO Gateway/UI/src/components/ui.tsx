import { useEffect, useState, type ReactNode } from "react"
import { cachedProviderIcon, cacheProviderIcon, providerIconUrl } from "@/lib/providerIdentity"
import { Buildings, Cube, Database, Key, List, Warning } from "@/components/icons"
import { cn } from "@/lib/utils"

// Provider identity — logo when available, monogram fallback (quiet, not branded)
export function ProviderMark({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const label = (name ?? "?").slice(0, 2).toUpperCase()
  const [src, setSrc] = useState(() => cachedProviderIcon(name))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    setSrc(cachedProviderIcon(name))
    if (!cachedProviderIcon(name)) void cacheProviderIcon(name).then((cached) => { if (cached) setSrc(cached) })
  }, [name])

  const remote = providerIconUrl(name)
  const image = src ?? (!failed ? remote : null)
  return (
    <span className={cn(`provider-mark provider-mark-${size}`, image && "provider-mark-image")} aria-label={name ?? "Unknown provider"} title={name ?? "Unknown provider"}>
      {image ? <img src={image} alt="" onError={() => { setFailed(true); setSrc(null) }} /> : label}
    </span>
  )
}

export function StatusDot({ status }: { status: "healthy" | "warning" | "error" | "neutral" }) {
  return <span className={`status-dot status-${status}`} aria-label={status} />
}

export function Surface({ children, className = "", ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return <section className={cn(`surface ${className}`)} {...props}>{children}</section>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

// Studio icon map for empty/error states — keeps one import surface, no emojis
const EMPTY_ICON_MAP: Record<string, React.ComponentType<{ size?: any; className?: string }>> = {
  database: Database,
  cube: Cube,
  key: Key,
  list: List,
  buildings: Buildings,
}

export function EmptyState({
  icon = "database",
  title,
  detail,
  action,
}: {
  icon?: keyof typeof EMPTY_ICON_MAP
  title: string
  detail: string
  action?: ReactNode
}) {
  const Glyph = EMPTY_ICON_MAP[icon] ?? Database
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Glyph size="lg" className="text-muted-foreground" />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <Warning size="sm" />
      <span>{message}</span>
      {onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function LoadingLine() {
  return <div className="loading-line"><span /><span /><span /></div>
}

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action && <div className="section-heading-action">{action}</div>}</div>
}
