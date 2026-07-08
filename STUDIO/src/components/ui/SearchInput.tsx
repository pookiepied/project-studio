import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, Close, type IconSize } from "@/components/icons";

type SearchSize = "sm" | "md" | "lg";

interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** The current search value. When non-empty, a clear button is shown. */
  value: string;
  /** Called when the value changes (including when cleared). */
  onValueChange: (value: string) => void;
  /** Accessible label (replaces the visual placeholder for AT). */
  "aria-label": string;
  size?: SearchSize;
  /** Icon size override; defaults from the `size` prop. */
  iconSize?: IconSize;
}

const containerClasses: Record<SearchSize, string> = {
  sm: "h-7 px-2.5 pl-7 pr-7 text-sm",
  md: "h-8 px-3 pl-9 pr-9 text-base",
  lg: "h-10 px-3.5 pl-10 pr-9 text-lg",
};

const leadingIconSize: Record<SearchSize, IconSize> = {
  sm: "xs",
  md: "sm",
  lg: "md",
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onValueChange,
      size = "md",
      iconSize,
      className = "",
      disabled,
      placeholder,
      "aria-label": ariaLabel,
      onChange,
      ...props
    },
    ref,
  ) => {
    const leading = iconSize ?? leadingIconSize[size];

    return (
      <div className="relative w-full">
        <Search
          size={leading}
          weight="regular"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          ref={ref}
          type="search"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => {
            onChange?.(e);
            onValueChange(e.currentTarget.value);
          }}
          className={`w-full rounded-lg border border-surface-border bg-surface-base text-primary placeholder:text-muted transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-disabled ${containerClasses[size]} ${className}`}
          {...props}
        />
        {value && !disabled && (
          // eslint-disable-next-line no-restricted-syntax -- in-field clear control; IconButton's size floor (sm=h-7) exceeds the field's right-padding budget (pr-7/9). Same composite-search pattern as C-402.
          <button
            type="button"
            onClick={() => onValueChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page"
          >
            <Close size="xs" weight="regular" />
          </button>
        )}
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
