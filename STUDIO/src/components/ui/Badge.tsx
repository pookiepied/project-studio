import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone = "default" | "strong" | "muted" | "outline";
type BadgeSize = "sm" | "md";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
}

const toneClasses: Record<BadgeTone, string> = {
  default: "border-transparent bg-surface-selected text-secondary",
  strong: "border-transparent bg-primary text-on-emphasis",
  muted: "border-transparent bg-surface-hover text-muted",
  outline: "border-surface-border bg-transparent text-secondary",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "gap-1 px-1.5 py-0.5 text-2xs",
  md: "gap-1.5 px-2 py-0.5 text-xs",
};

const dotClasses: Record<BadgeTone, string> = {
  default: "bg-secondary",
  strong: "bg-on-emphasis",
  muted: "bg-muted",
  outline: "bg-secondary",
};

export function Badge({
  children,
  tone = "default",
  size = "sm",
  dot = false,
  className = "",
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center rounded-full border font-medium leading-none ${toneClasses[tone]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`}
        />
      )}
      {children}
    </span>
  );
}
