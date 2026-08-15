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
  ArrowClockwise as ArrowClockwiseGlyph,
  ArrowUpRight as ArrowUpRightGlyph,
  ArrowUp,
  BookOpen as BookOpenGlyph,
  Brain as BrainGlyph,
  Briefcase as BriefcaseGlyph,
  Buildings as BuildingsGlyph,
  Camera as CameraGlyph,
  CaretDown,
  CaretRight,
  CaretUp,
  ChartLineUp as ChartLineUpGlyph,
  ChatCircle,
  Check as CheckGlyph,
  Clock as ClockGlyph,
  Coins as CoinsGlyph,
  Copy as CopyGlyph,
  Cube as CubeGlyph,
  Database as DatabaseGlyph,
  DotsThree as DotsThreeGlyph,
  Eye as EyeGlyph,
  File as FileGlyph,
  Flask as FlaskGlyph,
  Funnel as FunnelGlyph,
  Command as CommandGlyph,
  Folder as FolderGlyph,
  FolderOpen as FolderOpenGlyph,
  Gauge as GaugeGlyph,
  Gear,
  GitBranch as GitBranchGlyph,
  Heartbeat as HeartbeatGlyph,
  Key as KeyGlyph,
  Lightning as LightningGlyph,
  PauseCircle as PauseCircleGlyph,
  PlayCircle as PlayCircleGlyph,
  LinkSimple as LinkSimpleGlyph,
  ListBullets as ListBulletsGlyph,
  ListChecks as ListChecksGlyph,
  LockKey as LockKeyGlyph,
  MagnifyingGlass as MagnifyingGlassGlyph,
  Microphone as MicrophoneGlyph,
  Monitor as MonitorGlyph,
  Moon as MoonGlyph,
  MusicNotes as MusicNotesGlyph,
  NotePencil as NotePencilGlyph,
  Palette as PaletteGlyph,
  Paperclip as PaperclipGlyph,
  Plus as PlusGlyph,
  Rocket as RocketGlyph,
  ShieldCheck,
  SignOut as SignOutGlyph,
  SlidersHorizontal as SlidersHorizontalGlyph,
  SpinnerGap as SpinnerGapGlyph,
  SquaresFour,
  Stack as StackGlyph,
  Stop as StopGlyph,
  Sun as SunGlyph,
  Trash as TrashGlyph,
  TrendUp as TrendUpGlyph,
  Info as InfoGlyph,
  UploadSimple as UploadSimpleGlyph,
  UsersThree as UsersThreeGlyph,
  WarningCircle as WarningCircleGlyph,
  Code as CodeGlyph,
  TextAlignLeft,
  User as UserGlyph,
  X,
  type Icon as PhosphorIcon,
  type IconProps as PhosphorIconProps,
  type IconWeight,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { SidebarOutline } from '@/components/icons/SidebarOutline'

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

export const Account = makeIcon(UserGlyph, 'Account')
export const Attach = makeIcon(PaperclipGlyph, 'Attach')
export const Apps = makeIcon(SquaresFour, 'Apps')
export const Book = makeIcon(BookOpenGlyph, 'Book')
export const Briefcase = makeIcon(BriefcaseGlyph, 'Briefcase')
export const Camera = makeIcon(CameraGlyph, 'Camera')
export const Chat = makeIcon(ChatCircle, 'Chat')
export const Check = makeIcon(CheckGlyph, 'Check')
export const Close = makeIcon(X, 'Close')
export const Code = makeIcon(CodeGlyph, 'Code')
export const Collapse = makeIcon(CaretUp, 'Collapse')
export const Copy = makeIcon(CopyGlyph, 'Copy')
export const Disclosure = makeIcon(CaretRight, 'Disclosure')
export const File = makeIcon(FileGlyph, 'File')
export const Flask = makeIcon(FlaskGlyph, 'Flask')
export const Folder = makeIcon(FolderGlyph, 'Folder')
export const Branch = makeIcon(GitBranchGlyph, 'Branch')
export const Command = makeIcon(CommandGlyph, 'Command')
export const Link = makeIcon(LinkSimpleGlyph, 'Link')
export const Music = makeIcon(MusicNotesGlyph, 'Music')
export const Note = makeIcon(NotePencilGlyph, 'Note')
export const Palette = makeIcon(PaletteGlyph, 'Palette')
export const Permission = makeIcon(ShieldCheck, 'Permission')
export const Plus = makeIcon(PlusGlyph, 'Plus')
export const Preview = makeIcon(EyeGlyph, 'Preview')
export const Rocket = makeIcon(RocketGlyph, 'Rocket')
export const Search = makeIcon(MagnifyingGlassGlyph, 'Search')
export const SignOut = makeIcon(SignOutGlyph, 'SignOut')
export const Tasks = makeIcon(ListChecksGlyph, 'Tasks')
// Sidebar — custom outline (see `SidebarOutline.tsx`). Replaces Phosphor
// `SidebarSimple` (which embeds a vertical divider). This is a true
// component-based fix: dedicated `SidebarOutline` component, no `<line>`,
// inspired by `archive/STUDIO/src/ui/icons/WorkspaceIcons.tsx:NavToggleIcon`
// but with own metrics (rx 2.5, stroke 1.25) — not a direct copy. Both rails
// share this single concept; no mirroring (see chrome/PanelToggle.tsx).
export const Sidebar = SidebarOutline
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
// Gateway — extended concepts, same rules (regular only, size scale via Icon wrapper)
export const Activity = makeIcon(HeartbeatGlyph, 'Activity')
export const ArrowClockwise = makeIcon(ArrowClockwiseGlyph, 'ArrowClockwise')
export const ArrowUpRight = makeIcon(ArrowUpRightGlyph, 'ArrowUpRight')
export const Buildings = makeIcon(BuildingsGlyph, 'Buildings')
export const Chart = makeIcon(ChartLineUpGlyph, 'Chart')
export const Clock = makeIcon(ClockGlyph, 'Clock')
export const Coins = makeIcon(CoinsGlyph, 'Coins')
export const Cube = makeIcon(CubeGlyph, 'Cube')
export const Database = makeIcon(DatabaseGlyph, 'Database')
export const Dots = makeIcon(DotsThreeGlyph, 'Dots')
export const Filter = makeIcon(FunnelGlyph, 'Filter')
export const Gauge = makeIcon(GaugeGlyph, 'Gauge')
export const Heartbeat = makeIcon(HeartbeatGlyph, 'Heartbeat')
export const Key = makeIcon(KeyGlyph, 'Key')
export const Lightning = makeIcon(LightningGlyph, 'Lightning')
export const List = makeIcon(ListBulletsGlyph, 'List')
export const Lock = makeIcon(LockKeyGlyph, 'Lock')
export const Pause = makeIcon(PauseCircleGlyph, 'Pause')
export const Play = makeIcon(PlayCircleGlyph, 'Play')
export const Sliders = makeIcon(SlidersHorizontalGlyph, 'Sliders')
export const Spinner = makeIcon(SpinnerGapGlyph, 'Spinner')
export const Grid = makeIcon(SquaresFour, 'Grid')
export const Stack = makeIcon(StackGlyph, 'Stack')
export const Trash = makeIcon(TrashGlyph, 'Trash')
export const Trend = makeIcon(TrendUpGlyph, 'Trend')
export const Info = makeIcon(InfoGlyph, 'Info')
export const Upload = makeIcon(UploadSimpleGlyph, 'Upload')
export const Users = makeIcon(UsersThreeGlyph, 'Users')
export const Warning = makeIcon(WarningCircleGlyph, 'Warning')
