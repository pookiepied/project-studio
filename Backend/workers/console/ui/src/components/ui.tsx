import { motion } from "framer-motion";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { SURFACE } from "../design/tokens";
import { cn } from "../lib/cn";

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
        "transition-colors duration-fast",
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
 * A destructive action that asks once, in place.
 *
 * Revoking a session or disabling an account takes effect immediately and
 * cannot be undone from here — and both of these sit at the end of a row, a few
 * pixels from a harmless one, on a page where the rows look alike. That is a
 * misclick waiting to happen.
 *
 * The second press is the confirmation. A dialog would be the usual answer, but
 * it moves focus, covers the row you were reading, and trains you to dismiss it
 * — whereas a label that changes under the cursor is read, because the word you
 * were about to click is not the word that is there now. It disarms on a timer
 * and on mouse-out, so an armed button is never left lying around.
 */
export function Confirm({
  label,
  confirm,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <Button
      variant="danger"
      disabled={disabled}
      aria-label={armed ? confirm : label}
      onMouseLeave={() => setArmed(false)}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={cn(armed && "bg-danger/10", className)}
    >
      {armed ? confirm : label}
    </Button>
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
        "transition-colors duration-fast hover:bg-tint active:bg-selected",
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
        "transition-colors duration-fast",
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

/** A page arriving. The preset lives in `design/tokens`; see the note there. */
export function Appear({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div {...SURFACE} className={className}>
      {children}
    </motion.div>
  );
}
