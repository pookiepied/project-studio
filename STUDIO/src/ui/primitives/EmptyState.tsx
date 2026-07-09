import type { HTMLAttributes, ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";

type EmptyStateSize = "sm" | "md";

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: Icon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  size?: EmptyStateSize;
}

const spacingClasses: Record<EmptyStateSize, string> = {
  sm: "px-4 py-10",
  md: "px-6 py-16",
};

const iconBoxClasses: Record<EmptyStateSize, string> = {
  sm: "mb-3 h-9 w-9",
  md: "mb-4 h-10 w-10",
};

export function EmptyState({
  icon: IconComponent,
  title,
  body,
  action,
  size = "md",
  className = "",
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${spacingClasses[size]} ${className}`}
      {...props}
    >
      {IconComponent && (
        <div
          className={`flex items-center justify-center rounded-lg border border-surface-border bg-surface-base ${iconBoxClasses[size]}`}
          aria-hidden="true"
        >
          <IconComponent size={18} weight="regular" className="text-muted" />
        </div>
      )}
      <p className="mb-1 text-sm font-medium text-secondary">{title}</p>
      {body && (
        <p className="max-w-64 text-xs leading-relaxed text-muted">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
