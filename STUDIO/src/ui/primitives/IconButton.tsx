import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type IconButtonVariant = "ghost" | "outline" | "emphasis" | "destructive";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  children: ReactNode;
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: "text-secondary hover:bg-surface-hover hover:text-primary",
  outline: "border border-surface-border text-secondary hover:bg-surface-hover hover:text-primary",
  emphasis: "bg-primary text-on-emphasis hover:bg-secondary",
  destructive: "bg-primary text-on-emphasis hover:bg-secondary font-semibold",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 text-sm",
  md: "h-8 w-8 text-base",
  lg: "h-10 w-10 text-lg",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      children,
      variant = "ghost",
      size = "md",
      className = "",
      type = "button",
      disabled,
      ...props
    },
    ref,
  ) => {
    const disabledClasses = disabled ? "cursor-not-allowed opacity-50" : "";

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page",
          variantClasses[variant],
          sizeClasses[size],
          disabledClasses,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
