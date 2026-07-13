import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={cn("flex-shrink-0 px-6 pt-6 pb-4 border-b border-surface-border", className)}>
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <div>
          <h1 className="text-xl font-display font-normal text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="ml-auto flex items-center gap-4">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
