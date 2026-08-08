import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

export interface SliderProps extends ComponentPropsWithoutRef<"input"> {
  label?: string;
  valueLabel?: string;
}

export function Slider({
  label,
  valueLabel,
  className = "",
  ...props
}: SliderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {(label || valueLabel) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-sm text-secondary">{label}</span>}
          {valueLabel && <span className="text-sm text-muted tabular-nums">{valueLabel}</span>}
        </div>
      )}
      <input
        type="range"
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-hover outline-none",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:hover:bg-secondary",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer",
          "focus-visible:ring-2 focus-visible:ring-focus",
          className,
        )}
        {...props}
      />
    </div>
  );
}
