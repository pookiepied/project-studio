import * as RadixSelect from "@radix-ui/react-select";
import { CaretDownIcon as CaretDown, CheckIcon as Check } from "@phosphor-icons/react";
import type { ComponentPropsWithoutRef } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps
  extends Omit<ComponentPropsWithoutRef<typeof RadixSelect.Trigger>, "children" | "value" | "onChange"> {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const Select = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  disabled = false,
  ...triggerProps
}: SelectProps) => {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={`group flex w-full items-center justify-between rounded-lg border border-surface-border bg-surface-base px-3 py-1.5 text-left text-sm text-primary transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...triggerProps}
      >
        <span className={selectedOption ? "text-primary" : "text-muted"}>
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <CaretDown
            size={14}
            weight="regular"
            className="text-muted transition-transform duration-fast ease-standard group-data-[state=open]:rotate-180"
          />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={8}
          className="z-popover w-[var(--radix-select-trigger-width)] origin-top rounded-lg border border-surface-border bg-surface-base shadow-lg data-[state=open]:animate-scale-in"
        >
          <RadixSelect.Viewport className="max-h-60 overflow-y-auto scrollbar-auto-hide">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm text-secondary outline-none transition-colors duration-fast ease-standard data-[highlighted]:bg-surface-hover data-[highlighted]:text-primary data-[state=checked]:bg-surface-selected data-[state=checked]:font-medium data-[state=checked]:text-primary"
              >
                <RadixSelect.ItemText>
                  <span>{option.label}</span>
                </RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check size={14} weight="regular" className="text-primary" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
};
