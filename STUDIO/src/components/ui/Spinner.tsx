import type { HTMLAttributes } from "react";

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
  decorative?: boolean;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "h-3.5 w-3.5 border-2",
  md: "h-4 w-4 border-2",
  lg: "h-5 w-5 border-2",
};

export function Spinner({
  size = "md",
  label = "Loading",
  decorative = false,
  className = "",
  ...props
}: SpinnerProps) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={`inline-block shrink-0 rounded-full border-current border-t-transparent motion-safe:animate-spin ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
