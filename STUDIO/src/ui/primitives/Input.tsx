import { forwardRef, type InputHTMLAttributes } from "react";

export type FieldSize = "sm" | "md" | "lg";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: FieldSize;
}

const sizeClasses: Record<FieldSize, string> = {
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-base",
  lg: "h-10 px-3.5 text-lg",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", size = "md", disabled, type = "text", ...props }, ref) => {
    const disabledClasses = disabled
      ? "cursor-not-allowed bg-surface-raised text-disabled placeholder:text-disabled"
      : "";

    return (
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        className={`w-full rounded-lg border border-surface-border bg-surface-base text-primary placeholder:text-muted transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${sizeClasses[size]} ${disabledClasses} ${className}`}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
