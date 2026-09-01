import { forwardRef, type ComponentProps } from "react";
import { cn } from "../../lib/cn";

/**
 * The field treatment.
 *
 * Focus is a border that darkens plus a 2px ring drawn *inside* the field's own
 * box. What it replaces was `ring-1 ring-hairline` at rest with
 * `focus-visible:ring-2 ring-ring/40` on top — a second ring outside the first,
 * which on either surface read as a thick grey halo and made clicking a field
 * look like an error state rather than like focus.
 *
 * STUDIO reached the same treatment from the same complaint, and its note is
 * the reason this stays monochrome rather than reaching for an accent: a
 * monochrome ring has to stay quiet, because unlike a blue one it cannot rely
 * on hue to say "this is focus rather than a warning". The palette's rule —
 * chroma 0 except `--danger` — is what makes any colour on this screen mean
 * something, and focus is not information, it is a location.
 *
 * `focus` rather than `focus-visible`, deliberately: a text field is the one
 * control where a pointer user needs the indicator too, because the caret alone
 * is a two-pixel line and "which box am I typing in" is a real question in a
 * form. The global `:focus-visible` outline is suppressed here so the two do
 * not stack — the outer one floats 2px off the field, bulges past its corners
 * on a short control, and is the first thing an `overflow` ancestor clips.
 */
const BASE = [
  // `min-w-0` is load-bearing: a field is often `flex-1` inside a row, and a
  // flex item refuses to shrink below its intrinsic width unless the minimum
  // is released — so in a narrow row the field overflows and gets clipped at
  // the edges rather than shrinking. Every field here lives in some layout;
  // none of them wants the default minimum.
  "w-full min-w-0 rounded-lg border border-hairline bg-surface-sunken px-2.5",
  "h-(--control-md) text-ui text-foreground",
  "placeholder:text-muted-foreground/70",
  "transition-[border-color,box-shadow] duration-fast outline-none",
  "focus:border-foreground/20 focus:shadow-[0_0_0_2px_var(--ring)]",
  // The bang is load-bearing: the base layer's `:focus-visible` rule is
  // unlayered, and an unlayered rule beats every utility layer without it.
  "focus-visible:outline-none!",
  "disabled:opacity-40",
].join(" ");

export const Field = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Field(
  { className, ...props },
  ref,
) {
  return <input ref={ref} {...props} className={cn(BASE, className)} />;
});
