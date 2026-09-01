import { motion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/* ── Surfaces ──────────────────────────────────────────────────────────────
   Depth is carried by surface ordering plus a hairline, never by a drop shadow
   alone — a shadow on its own makes a panel read as a sticker.
   ────────────────────────────────────────────────────────────────────────── */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl bg-surface ring-1 ring-hairline shadow-chip", className)}>
      {children}
    </div>
  );
}

/** A titled block. The label is micro and muted: a signpost, not content. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex min-h-(--control-sm) items-center justify-between gap-3">
        <h2 className="text-micro uppercase text-muted-foreground">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-caption px-3 py-8 text-center text-muted-foreground">{children}</div>;
}

/* ── Controls ──────────────────────────────────────────────────────────────
   One state, one channel. Hover brings the chip in; the label never darkens,
   thickens, or moves, and the control does not scale — a control that grows
   under the cursor is a touch affordance, and under a pointer it reads as the
   layout being unstable.
   ────────────────────────────────────────────────────────────────────────── */

export function Button({
  className,
  variant = "quiet",
  ...props
}: ComponentProps<"button"> & { variant?: "quiet" | "solid" | "danger" }) {
  return (
    <button
      {...props}
      className={cn(
        "text-ui inline-flex h-(--control-md) items-center gap-1.5 rounded-lg px-2.5",
        "outline-none transition-colors duration-fast",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-40",
        variant === "quiet" && "hover:bg-tint active:bg-selected",
        variant === "solid" &&
          "bg-primary text-primary-foreground hover:opacity-90 active:opacity-80",
        variant === "danger" && "text-danger hover:bg-danger/10 active:bg-danger/15",
        className,
      )}
    />
  );
}

/**
 * Icon-only controls are circles, always. Four corners at this size are four
 * things asking to be noticed, and the chip is the whole state signal now.
 */
export function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={cn(
        "inline-grid size-(--control-md) place-items-center rounded-full",
        "outline-none transition-colors duration-fast",
        "hover:bg-tint active:bg-selected focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "text-ui h-(--control-md) min-w-0 rounded-lg bg-surface-sunken px-2.5",
        "ring-1 ring-hairline outline-none transition-shadow duration-fast",
        "placeholder:text-muted-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "text-ui h-(--control-md) appearance-none rounded-lg bg-surface-sunken pl-2.5 pr-6",
        "ring-1 ring-hairline outline-none transition-shadow duration-fast",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        "chevron",
        className,
      )}
    />
  );
}

/**
 * A filter chip. Selection is a translucent tint of the foreground, so it
 * composites onto whatever surface it lands on rather than reading as an opaque
 * swatch dropped behind the label.
 */
export function Chip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        "text-caption inline-flex h-(--control-sm) items-center gap-1.5 whitespace-nowrap rounded-full px-2.5",
        "outline-none transition-colors duration-fast",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        active ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-tint",
        className,
      )}
    />
  );
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

/** A list whose separator is a hairline between rows, never a border around them. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-hairline", className)}>{children}</div>;
}

export function Row({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2 text-left",
          "transition-colors duration-fast hover:bg-tint",
          className,
        )}
      >
        {children}
      </button>
    );
  }
  return <div className={cn("flex items-center gap-3 px-3 py-2", className)}>{children}</div>;
}

/**
 * Things that appear or vanish use a duration and an ease-out. There is no
 * object to model, so a spring would only be latency.
 */
export function Appear({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
