/*
 * ───────────────────────────────────────────────────────────────────────────
 * Semantic icon barrel — the SINGLE import surface for UI glyphs.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Rules (frontend-revamp/01-AUDIT.md §17 + Appendix E):
 *   • One library — Phosphor — imported ONLY here. Consumers import the
 *     concept (`Close`, `Send`, …), never the raw glyph.
 *   • One resting weight: `regular`. `weight="fill"` ONLY for active/selected.
 *     `thin` / `duotone` / default-`bold` are banned.
 *   • One size scale (`xs`/`sm`/`md`/`lg`/`xl`) via the `<Icon>` wrapper — no
 *     raw `size={n}`.
 *   • `currentColor` for all monochrome marks (Phosphor already does this).
 *     Multi-color brand logos are a separate category — see `components/brand`.
 *
 * Canonical concept → glyph mapping (retire all duplicates as features migrate):
 *   Close=X · Back=ArrowLeft · Send=ArrowUp · Refresh=ArrowsClockwise · Loading=SpinnerGap
 *   Settings=Gear · Manage=SlidersHorizontal · Delete=Trash · Copy=Copy
 *   Success=CheckCircle · ErrorIcon=XCircle · Warning=Warning
 *   Expand=CaretDown · Collapse=CaretRight · Edit=PencilSimple · Search=MagnifyingGlass
 *
 * Adding a concept: import its glyph below and add a `makeIcon` line — do NOT
 * import Phosphor directly in feature code.
 */
import { forwardRef } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  Copy as CopyGlyph,
  Gear,
  MagnifyingGlass,
  PencilSimple,
  SlidersHorizontal,
  SpinnerGap,
  Trash,
  Warning as WarningGlyph,
  ArrowUp,
  X,
  XCircle,
  type Icon as PhosphorIcon,
  type IconProps as PhosphorIconProps,
  type IconWeight,
} from "@phosphor-icons/react";

/** The only sanctioned icon sizes (px). No raw numbers in consumers. */
export const iconSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const;
export type IconSize = keyof typeof iconSize;

export interface IconProps extends Omit<PhosphorIconProps, "size" | "weight"> {
  /** A keyword from the icon size scale. Defaults to `md` (16px). */
  size?: IconSize;
  /** Resting weight is `regular`; pass `fill` only for active/selected state. */
  weight?: IconWeight;
}

interface IconWrapperProps extends IconProps {
  /** A raw Phosphor glyph — the escape hatch for concepts not yet in the barrel. */
  icon: PhosphorIcon;
}

/**
 * Base wrapper that enforces the size scale + default weight. Prefer the
 * semantic concept exports below; use `<Icon icon={…} />` only for one-offs
 * during feature migration (then promote them to a concept here).
 */
export const Icon = forwardRef<SVGSVGElement, IconWrapperProps>(
  ({ icon: Glyph, size = "md", weight = "regular", ...rest }, ref) => (
    <Glyph ref={ref} size={iconSize[size]} weight={weight} {...rest} />
  ),
);
Icon.displayName = "Icon";

function makeIcon(glyph: PhosphorIcon, name: string) {
  const Concept = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <Icon ref={ref} icon={glyph} {...props} />
  ));
  Concept.displayName = name;
  return Concept;
}

// ── Canonical semantic concepts ─────────────────────────────────────────────
export const Close = makeIcon(X, "Close");
export const Back = makeIcon(ArrowLeft, "Back");
export const Send = makeIcon(ArrowUp, "Send");
export const Refresh = makeIcon(ArrowsClockwise, "Refresh");
/** Static loading glyph. For an animated indeterminate spinner use the `Spinner` primitive. */
export const Loading = makeIcon(SpinnerGap, "Loading");
export const Settings = makeIcon(Gear, "Settings");
export const Manage = makeIcon(SlidersHorizontal, "Manage");
export const Delete = makeIcon(Trash, "Delete");
export const Copy = makeIcon(CopyGlyph, "Copy");
export const Success = makeIcon(CheckCircle, "Success");
export const ErrorIcon = makeIcon(XCircle, "ErrorIcon");
export const Warning = makeIcon(WarningGlyph, "Warning");
export const Expand = makeIcon(CaretDown, "Expand");
export const Collapse = makeIcon(CaretRight, "Collapse");
export const Edit = makeIcon(PencilSimple, "Edit");
export const Search = makeIcon(MagnifyingGlass, "Search");

// ── Custom monochrome marks (live here per §17 step 5) ───────────────────────
export { NavToggleIcon, OverviewIcon } from "./WorkspaceIcons";
