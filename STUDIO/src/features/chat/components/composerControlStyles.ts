export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const composerToolbarGroup = "flex h-7 min-w-0 items-center gap-1";

export const composerIconButton =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md box-border leading-none transition-colors [&>svg]:block";

export const composerRoundIconButton =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full box-border leading-none transition-colors [&>svg]:block";

export const composerPillButton =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md box-border px-2 text-xs font-medium leading-none transition-all duration-150 [&>svg]:block";

export const composerPillLabel =
  "inline-flex h-full min-w-0 items-center leading-none";

export const composerDropdownPanel =
  "absolute bottom-full mb-2 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-xl overflow-hidden z-50";
