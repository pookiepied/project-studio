export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const composerToolbarGroup = "flex h-6 min-w-0 items-center gap-1";

export const composerRoundIconButton =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full box-border p-0 leading-none transition-colors [&>svg]:block";

export const composerPillButton =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md box-border px-1.5 py-0 text-xs font-medium leading-none transition-all duration-150 [&>svg]:block";

export const composerPillLabel =
  "inline-flex h-full min-w-0 items-center leading-none";
