import { motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { HealthStatus } from "@pookiepied/core/contracts";
import { SPRING_SNAPPY } from "../design/tokens";
import { cn } from "../lib/cn";
import { IconButton } from "./ui";
import { StatusDot } from "./status";
import type { Theme } from "../lib/theme";

export type PageId = "overview" | "activity" | "health" | "people";

const PAGES: { id: PageId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "health", label: "Health" },
  { id: "people", label: "People" },
];

/**
 * The mark.
 *
 * A ring with a dot in it, which is the status indicator this whole console is
 * built out of, drawn once at size. That is the only reason it earns a place:
 * an abstract glyph in the corner would be decoration, and a wordmark would be
 * a second typeface. This one is the interface's own vocabulary saying what the
 * product is — something that watches and reports.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 flex-none place-items-center rounded-full",
        "bg-primary text-primary-foreground",
        className,
      )}
    >
      <span className="grid size-3.5 place-items-center rounded-full ring-[1.5px] ring-current">
        <span className="size-1 rounded-full bg-current" />
      </span>
    </span>
  );
}

/**
 * Four text tabs, not a sidebar.
 *
 * A sidebar reserves a column for navigation whether or not there is anything
 * to navigate, and at four destinations it reads as scaffolding for an app that
 * expects to grow into an admin suite. This is not that; it is a small number of
 * pages and the tabs say so. Both reference dashboards reach the same
 * conclusion at the same count and put the nav in the top bar as pills.
 */
export function Nav({ page, onChange }: { page: PageId; onChange: (page: PageId) => void }) {
  return (
    <nav className="flex items-center gap-0.5 rounded-full bg-surface-sunken p-0.5">
      {PAGES.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          aria-current={p.id === page ? "page" : undefined}
          className={cn(
            "text-ui relative h-(--control-md) rounded-full px-3",
            "transition-colors duration-fast",
            p.id === page ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {/* The chip is the thing that moved, so it gets a spring — the physics
              is the feedback. The label underneath never shifts. */}
          {p.id === page ? (
            <motion.span
              layoutId="nav-chip"
              className="absolute inset-0 rounded-full bg-primary"
              transition={SPRING_SNAPPY}
            />
          ) : null}
          <span className="relative">{p.label}</span>
        </button>
      ))}
    </nav>
  );
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  const Icon = ICON[theme];
  return (
    <IconButton
      onClick={() => onChange(NEXT[theme])}
      aria-label={`Appearance: ${theme}. Switch to ${NEXT[theme]}.`}
      title={`Appearance: ${theme}`}
    >
      <Icon className="mark" strokeWidth={1.75} />
    </IconButton>
  );
}

/**
 * Who is signed in.
 *
 * The references put a photograph here. There is no photograph to put: the
 * console knows an email address and nothing else, because the identity comes
 * from an Access assertion rather than from a profile anyone filled in. So the
 * avatar is the initial, which is the honest version of the same shape — and
 * the address stays beside it, since on a control plane "which account am I
 * acting as" is a question worth being able to answer without hovering.
 */
export function Identity({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-caption hidden min-w-0 truncate text-muted-foreground sm:inline">
        {email}
      </span>
      <span
        aria-hidden
        className="text-caption grid size-7 flex-none place-items-center rounded-full bg-surface-sunken ring-1 ring-hairline"
      >
        {email.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

/** The bar across the top of the shell: what this is, where you are, who you are. */
export function TopBar({
  page,
  onPage,
  email,
  theme,
  onTheme,
}: {
  page: PageId;
  onPage: (p: PageId) => void;
  email: string | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  return (
    <header className="flex items-center gap-4 px-4 py-4 sm:px-7">
      <Mark />
      {/* The nav is centred on wide windows and left-aligned once the identity
          block folds away, rather than being centred against a shrinking gap. */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <Nav page={page} onChange={onPage} />
      </div>
      <div className="flex flex-none items-center gap-2">
        <Identity email={email} />
        <ThemeToggle theme={theme} onChange={onTheme} />
      </div>
    </header>
  );
}

/**
 * The page header: the one statement the page makes, and the controls that act
 * on the whole page rather than on one panel.
 *
 * The references put the title and the page-level actions on one line, and it
 * is worth copying because it makes the distinction visible: what is up here
 * governs everything below, and what is in a panel's own header governs only
 * that panel.
 */
export function PageHeader({
  title,
  status,
  actions,
}: {
  title: string;
  status: HealthStatus | null;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-5 pt-3 sm:px-7">
      <div className="flex items-baseline gap-3">
        <h1 className="text-display">{title}</h1>
        {status ? (
          <span className="flex items-center gap-1.5 pb-1">
            <StatusDot status={status} pulse />
            <span
              className={cn(
                "text-caption",
                status === "down" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {status === "ok"
                ? "All systems operational"
                : status === "degraded"
                  ? "Degraded"
                  : "Service down"}
            </span>
          </span>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
