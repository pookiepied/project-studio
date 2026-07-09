import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Spinner } from "@/ui/primitives/Spinner";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children: ReactNode;
  variant?: "primary" | "ghost" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
  /** Icon rendered before the label. */
  leftIcon?: ReactNode;
  /** Icon rendered after the label. */
  rightIcon?: ReactNode;
  /** Shows a spinning indicator and disables the button. */
  loading?: boolean;
  className?: string;
}

export const Button = ({
  children,
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  loading = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) => {
  const isDisabled = disabled || loading;

  const baseStyles =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page";

  const variantStyles = {
    primary:
      "bg-primary text-on-emphasis hover:bg-secondary",
    ghost:
      "bg-transparent text-secondary hover:bg-surface-hover hover:text-primary",
    outline:
      "border border-surface-border bg-transparent text-secondary hover:bg-surface-hover hover:text-primary",
    destructive:
      "bg-primary text-on-emphasis hover:bg-secondary font-semibold",
  };

  const sizeStyles = {
    sm: "px-2.5 py-1.5 text-sm h-7",
    md: "px-3 py-1.5 text-base h-8",
    lg: "px-4 py-2 text-lg h-10",
  };

  const disabledStyles = isDisabled ? "opacity-50 cursor-not-allowed" : "";

  return (
    <motion.button
      whileTap={!isDisabled ? { scale: 0.98 } : {}}
      transition={{ duration: 0.15 }}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {loading ? <Spinner size="md" decorative /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </motion.button>
  );
};
