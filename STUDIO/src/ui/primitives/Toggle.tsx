import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, MouseEvent } from "react";

type ToggleSize = "sm" | "md";

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: ToggleSize;
}

export const Toggle = ({
  checked,
  onChange,
  onClick,
  disabled = false,
  className = "",
  size = "md",
  ...props
}: ToggleProps) => {
  const sm = size === "sm";

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);

    if (!event.defaultPrevented && !disabled) {
      onChange(!checked);
    }
  };

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleClick}
      className={`relative inline-flex ${sm ? "h-4 w-7" : "h-5 w-9"} items-center rounded-full transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
        checked ? "bg-primary" : "bg-surface-selected"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      <motion.span
        animate={{ x: checked ? (sm ? 13 : 17) : (sm ? 2 : 3) }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`inline-block ${sm ? "h-3 w-3" : "h-3.5 w-3.5"} rounded-full bg-surface-page`}
      />
    </button>
  );
};
