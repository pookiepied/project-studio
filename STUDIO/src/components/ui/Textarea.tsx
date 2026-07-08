import { forwardRef, type TextareaHTMLAttributes } from "react";

type FieldSize = "sm" | "md" | "lg";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  size?: FieldSize;
}

const sizeClasses: Record<FieldSize, string> = {
  sm: "min-h-16 px-2.5 py-1.5 text-sm",
  md: "min-h-24 px-3 py-2 text-base",
  lg: "min-h-32 px-3.5 py-2.5 text-lg",
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", size = "md", disabled, ...props }, ref) => {
    const disabledClasses = disabled
      ? "cursor-not-allowed bg-surface-raised text-disabled placeholder:text-disabled"
      : "";

    return (
      <textarea
        ref={ref}
        disabled={disabled}
        className={`w-full resize-y rounded-lg border border-surface-border bg-surface-base text-primary placeholder:text-muted transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page ${sizeClasses[size]} ${disabledClasses} ${className}`}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
