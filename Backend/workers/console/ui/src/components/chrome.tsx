import { motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
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
 * Four text tabs, not a sidebar.
 *
 * A sidebar reserves a column for navigation whether or not there is anything
 * to navigate, and at four destinations it reads as scaffolding for an app that
 * expects to grow into an admin suite. This is not that; it is a small number of
 * pages and the tabs say so.
 */
export function Nav({
  page,
  onChange,
}: {
  page: PageId;
  onChange: (page: PageId) => void;
}) {
  return (
    <nav className="flex items-center gap-0.5">
      {PAGES.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          aria-current={p.id === page ? "page" : undefined}
          className={cn(
            "text-ui relative h-(--control-md) rounded-lg px-2.5",
            "transition-colors duration-fast",
            p.id === page ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {/* The chip is the thing that moved, so it gets a spring — the physics
              is the feedback. The label underneath never shifts. */}
          {p.id === page ? (
            <motion.span
              layoutId="nav-chip"
              className="absolute inset-0 rounded-lg bg-selected"
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
 * The page header.
 *
 * The title is the one statement the page makes, so it is the only serif on
 * screen. Everything else — who you are, what the system is doing — sits beside
 * it at caption weight, because it is context rather than content.
 */
export function Header({
  title,
  email,
  status,
  theme,
  onTheme,
  page,
  onPage,
}: {
  title: string;
  email: string | null;
  status: HealthStatus | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
  page: PageId;
  onPage: (p: PageId) => void;
}) {
  return (
    <header className="flex flex-col gap-5 pb-6">
      <div className="flex items-center justify-between gap-4">
        <Nav page={page} onChange={onPage} />
        <div className="flex items-center gap-2">
          {email ? (
            <span className="text-caption hidden text-muted-foreground sm:inline">{email}</span>
          ) : null}
          <ThemeToggle theme={theme} onChange={onTheme} />
        </div>
      </div>

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
    </header>
  );
}
