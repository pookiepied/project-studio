/*
 * Semantic icon barrel: the single import surface for UI glyphs.
 *
 * Rules:
 *   - One library: Phosphor, imported only here. Consumers import the concept
 *     (`Close`, `Send`), never the raw glyph.
 *   - One weight, always: `regular` outline. Filled glyphs are not available —
 *     the prop is not exposed, so a solid icon cannot be introduced by
 *     accident. Selection is shown with colour and background, the way macOS
 *     does it, never by swapping an outline for a solid shape.
 *   - One size scale (`xs`/`sm`/`md`/`lg`/`xl`) via the `<Icon>` wrapper. No
 *     raw `size={n}` in consumers.
 *   - `currentColor` for every monochrome mark (Phosphor does this already).
 *
 * Adding a concept: import its glyph and add a `makeIcon` line. Do not import
 * `@phosphor-icons/react` anywhere else.
 */
import { forwardRef } from 'react'
import {
  ArrowUp,
  Brain as BrainGlyph,
  CaretDown,
  CaretUp,
  ChatCircle,
  Check as CheckGlyph,
  Copy as CopyGlyph,
  Eye as EyeGlyph,
  FolderOpen as FolderOpenGlyph,
  Gear,
  Microphone as MicrophoneGlyph,
  Monitor as MonitorGlyph,
  Moon as MoonGlyph,
  Paperclip as PaperclipGlyph,
  ShieldCheck,
  Rectangle as PanelOutlineGlyph,
  TextAlignLeft,
  SquaresFour,
  Stop as StopGlyph,
  Sun as SunGlyph,
  X,
  type Icon as PhosphorIcon,
  type IconProps as PhosphorIconProps,
  type IconWeight,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Icon size scale, aligned with the type scale.
 *   xs (12px): pairs with text-xs, secondary text and captions
 *   sm (14px): pairs with text-sm, UI body and toolbar
 *   md (16px): standard interactive — the default
 *   lg (20px): empty states and hero
 *   xl (24px): large display
 *
 * Each entry carries both the pixel value and its Tailwind class. The class is
 * required, not redundant: `Button` sizes bare SVG children through
 * `[&_svg:not([class*='size-'])]`, and a CSS rule beats the width/height
 * attributes Phosphor emits. Carrying a `size-*` class opts every icon out of
 * that fallback so this scale stays authoritative inside buttons.
 */
const ICON_SIZE = {
  xs: { px: 12, className: 'size-3' },
  sm: { px: 14, className: 'size-3.5' },
  md: { px: 16, className: 'size-4' },
  lg: { px: 20, className: 'size-5' },
  xl: { px: 24, className: 'size-6' },
} as const

export type IconSize = keyof typeof ICON_SIZE

/**
 * Note the omitted `weight`: every icon renders as a `regular` outline. This is
 * a deliberate hole in the API, not an oversight.
 */
interface IconProps extends Omit<PhosphorIconProps, 'size' | 'weight'> {
  /** A keyword from the icon size scale. Defaults to `md` (16px). */
  size?: IconSize
}

interface IconWrapperProps extends IconProps {
  /** A raw Phosphor glyph — the escape hatch for one-off concepts. */
  icon: PhosphorIcon
}

/** The one weight every glyph in the app renders at. */
const WEIGHT: IconWeight = 'regular'

/** Base wrapper enforcing the size scale and the single weight. */
export const Icon = forwardRef<SVGSVGElement, IconWrapperProps>(
  ({ icon: Glyph, size = 'md', className, ...rest }, ref) => {
    const scale = ICON_SIZE[size]
    return (
      <Glyph
        ref={ref}
        size={scale.px}
        weight={WEIGHT}
        className={cn(scale.className, className)}
        {...rest}
      />
    )
  },
)
Icon.displayName = 'Icon'

function makeIcon(glyph: PhosphorIcon, name: string) {
  const Concept = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <Icon ref={ref} icon={glyph} {...props} />
  ))
  Concept.displayName = name
  return Concept
}

export const Attach = makeIcon(PaperclipGlyph, 'Attach')
export const Apps = makeIcon(SquaresFour, 'Apps')
export const Chat = makeIcon(ChatCircle, 'Chat')
export const Check = makeIcon(CheckGlyph, 'Check')
export const Close = makeIcon(X, 'Close')
export const Collapse = makeIcon(CaretUp, 'Collapse')
export const Copy = makeIcon(CopyGlyph, 'Copy')
export const Permission = makeIcon(ShieldCheck, 'Permission')
export const Preview = makeIcon(EyeGlyph, 'Preview')
// Sidebar (panel outline) — was `SidebarSimple` (Phosphor's panel with
// internal divider). We now use `Rectangle` which is the same outer rounded
// rect but without the vertical line, per Task 1. Both rails share this
// single concept; no mirroring needed (see SideRail.tsx comment).
export const Sidebar = makeIcon(PanelOutlineGlyph, 'Sidebar')
export const WordWrap = makeIcon(TextAlignLeft, 'WordWrap')
export const Expand = makeIcon(CaretDown, 'Expand')
export const Microphone = makeIcon(MicrophoneGlyph, 'Microphone')
export const Monitor = makeIcon(MonitorGlyph, 'Monitor')
export const Moon = makeIcon(MoonGlyph, 'Moon')
export const Reasoning = makeIcon(BrainGlyph, 'Reasoning')
export const Send = makeIcon(ArrowUp, 'Send')
export const Settings = makeIcon(Gear, 'Settings')
export const Stop = makeIcon(StopGlyph, 'Stop')
export const Sun = makeIcon(SunGlyph, 'Sun')
export const Workspace = makeIcon(FolderOpenGlyph, 'Workspace')
