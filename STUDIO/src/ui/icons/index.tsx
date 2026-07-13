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
 *   Close=X · Back=ArrowLeft · Send=ArrowUp · Refresh=ArrowsClockwise
 *   Settings=Gear · Manage=SlidersHorizontal · Delete=Trash · Copy=Copy
 *   Success=CheckCircle · Warning=Warning
 *   Expand=CaretDown · Collapse=CaretRight · Edit=PencilSimple · Search=MagnifyingGlass
 *
 * Adding a concept: import its glyph below and add a `makeIcon` line — do NOT
 * import Phosphor directly in feature code.
 */
import { forwardRef } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  Bell as BellGlyph,
  Brain as BrainGlyph,
  Briefcase,
  CalendarBlankIcon as CalendarGlyph,
  CaretDown,
  CaretRight,
  ChartLineUp,
  ChatCircle,
  ChatCircleTextIcon as ConversationGlyph,
  Check as CheckGlyph,
  CheckCircle,
  Clock as ClockGlyph,
  Cloud as CloudGlyph,
  Code as CodeGlyph,
  Compass as CompassGlyph,
  Copy as CopyGlyph,
  Cpu as CpuGlyph,
  DotsThree,
  Eye as EyeGlyph,
  EnvelopeSimple as EmailGlyph,
  FileText,
  Files as FilesGlyph,
  Folder as FolderGlyph,
  FolderOpen as FolderOpenGlyph,
  Gear,
  Globe as GlobeGlyph,
  HardDrives,
  Info as InfoGlyph,
  Keyboard as KeyboardGlyph,
  Leaf,
  Lightning as LightningGlyph,
  List as ListGlyph,
  ListChecks,
  LockSimple,
  MagnifyingGlass,
  Microphone as MicrophoneGlyph,
  Minus,
  Monitor as MonitorGlyph,
  Moon as MoonGlyph,
  Pause as PauseGlyph,
  PencilSimple,
  Play as PlayGlyph,
  Plus,
  Question as QuestionGlyph,
  Shield as ShieldGlyph,
  ShieldCheck as ShieldCheckGlyph,
  SignOut,
  SlidersHorizontal,
  SpeakerHigh,
  SpinnerGap,
  SquaresFour,
  Stop as StopGlyph,
  Sun as SunGlyph,
  Terminal as TerminalGlyph,
  Trash,
  User as UserGlyph,
  UserCircle as UserCircleGlyph,
  Warning as WarningGlyph,
  WarningCircle,
  Waveform as WaveformGlyph,
  WifiHigh,
  WifiSlash,
  X,
  XCircle,
  type Icon as PhosphorIcon,
  type IconProps as PhosphorIconProps,
  type IconWeight,
} from "@phosphor-icons/react";

/** Icon size scale — aligned with the type scale (src/design/typography.css).
 *   xs (12px) → pairs with text-xs (11px)   — secondary text, captions
 *   sm (14px) → pairs with text-sm (12px)   — UI body, toolbar
 *   md (16px) → pairs with text-lg (15px)   — standard interactive
 *   lg (20px) → pairs with text-2xl (20px)  — empty states, hero
 *   xl (24px) → pairs with text-3xl (26px)  — large display
 * No raw numbers in consumers. */
const iconSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const;
export type IconSize = keyof typeof iconSize;

interface IconProps extends Omit<PhosphorIconProps, "size" | "weight"> {
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
export const Settings = makeIcon(Gear, "Settings");
export const Manage = makeIcon(SlidersHorizontal, "Manage");
export const Delete = makeIcon(Trash, "Delete");
export const Copy = makeIcon(CopyGlyph, "Copy");
export const Success = makeIcon(CheckCircle, "Success");
export const Warning = makeIcon(WarningGlyph, "Warning");
export const Expand = makeIcon(CaretDown, "Expand");
export const Collapse = makeIcon(CaretRight, "Collapse");
export const Edit = makeIcon(PencilSimple, "Edit");
export const Search = makeIcon(MagnifyingGlass, "Search");

// ── Extended semantic concepts ───────────────────────────────────────────────
// Promoted from the raw escape-hatch set: each covers a glyph used across 3+
// consumer files (see migration guide §Common icons). Consumers should now use
// these concept names — not the raw `*Icon` re-exports lower in this file.
export const Add = makeIcon(Plus, "Add");
export const Check = makeIcon(CheckGlyph, "Check");
export const Remove = makeIcon(Minus, "Remove");
export const More = makeIcon(DotsThree, "More");
export const Microphone = makeIcon(MicrophoneGlyph, "Microphone");
export const Bell = makeIcon(BellGlyph, "Bell");
export const Moon = makeIcon(MoonGlyph, "Moon");
export const Sun = makeIcon(SunGlyph, "Sun");
export const Terminal = makeIcon(TerminalGlyph, "Terminal");
export const Play = makeIcon(PlayGlyph, "Play");
export const Stop = makeIcon(StopGlyph, "Stop");
export const Forward = makeIcon(ArrowRight, "Forward");
export const Undo = makeIcon(ArrowCounterClockwise, "Undo");
export const Error = makeIcon(WarningCircle, "Error");
export const WifiOff = makeIcon(WifiSlash, "WifiOff");
export const Keyboard = makeIcon(KeyboardGlyph, "Keyboard");
export const Lock = makeIcon(LockSimple, "Lock");
export const Globe = makeIcon(GlobeGlyph, "Globe");
export const ExternalLink = makeIcon(ArrowSquareOut, "ExternalLink");
export const Eye = makeIcon(EyeGlyph, "Eye");
export const Clock = makeIcon(ClockGlyph, "Clock");
export const Reject = makeIcon(XCircle, "Reject");
export const Message = makeIcon(ChatCircle, "Message");
export const Cloud = makeIcon(CloudGlyph, "Cloud");
export const Eco = makeIcon(Leaf, "Eco");
export const Info = makeIcon(InfoGlyph, "Info");
export const Brain = makeIcon(BrainGlyph, "Brain");
export const FolderOpen = makeIcon(FolderOpenGlyph, "FolderOpen");
export const Folder = makeIcon(FolderGlyph, "Folder");
export const Project = makeIcon(Briefcase, "Project");
export const Activity = makeIcon(ChartLineUp, "Activity");
export const Document = makeIcon(FileText, "Document");
export const Files = makeIcon(FilesGlyph, "Files");
export const Code = makeIcon(CodeGlyph, "Code");
export const Grid = makeIcon(SquaresFour, "Grid");
export const Spinner = makeIcon(SpinnerGap, "Spinner");
export const Storage = makeIcon(HardDrives, "Storage");
export const UserCircle = makeIcon(UserCircleGlyph, "UserCircle");
export const User = makeIcon(UserGlyph, "User");
export const Cpu = makeIcon(CpuGlyph, "Cpu");
export const Waveform = makeIcon(WaveformGlyph, "Waveform");
export const Lightning = makeIcon(LightningGlyph, "Lightning");
export const Monitor = makeIcon(MonitorGlyph, "Monitor");
export const Shield = makeIcon(ShieldGlyph, "Shield");
export const ShieldCheck = makeIcon(ShieldCheckGlyph, "ShieldCheck");
export const Compass = makeIcon(CompassGlyph, "Compass");
export const Logout = makeIcon(SignOut, "Logout");
export const List = makeIcon(ListGlyph, "List");
export const Checklist = makeIcon(ListChecks, "Checklist");
export const Redo = makeIcon(ArrowClockwise, "Redo");
export const Volume = makeIcon(SpeakerHigh, "Volume");
export const Conversation = makeIcon(ConversationGlyph, "Conversation");
export const Pause = makeIcon(PauseGlyph, "Pause");
export const Question = makeIcon(QuestionGlyph, "Question");
export const Calendar = makeIcon(CalendarGlyph, "Calendar");
export const Email = makeIcon(EmailGlyph, "Email");
export const Wifi = makeIcon(WifiHigh, "Wifi");

// ── Type re-exports (consumers must not import phosphor types) ───────────────
// Consumers that previously imported Phosphor's `Icon` type (as a bare type or
// aliased to `PhosphorIcon`) must instead import `PhosphorIcon` here — the
// barrel already defines the `Icon` *value* (the wrapper component above), so
// the Phosphor type is re-exported only under the non-colliding `PhosphorIcon`.
export type { PhosphorIcon, PhosphorIconProps, IconWeight };

// ── Escape-hatch glyph re-exports ────────────────────────────────────────────
// `ArrowsClockwise` and `X` are also imported locally (for the Refresh/Close
// concepts above), so they are exported from the local binding to avoid a
// `export { … } from` re-declaration of the same name.
export { ArrowsClockwise, X };
// Every glyph below is re-exported verbatim so consumption stays within the
// barrel. Concepts (above) remain the preferred surface; these raw glyphs are
// the `<Icon icon={Glyph} … />` escape hatch and are also used directly where a
// numeric pixel size is still required (e.g. numeric-size brand resolvers).
export {
  ArchiveBoxIcon,
  ArrowBendUpRight,
  ArrowCircleUpIcon,
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsSplitIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  BellIcon,
  BookOpenIcon,
  BracketsCurlyIcon,
  BrainIcon,
  BriefcaseIcon,
  BroadcastIcon,
  BroomIcon,
  BrowsersIcon,
  BugIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  ChartLineUp,
  ChartLineUpIcon,
  ChatCircle,
  ChatCircleIcon,
  ChatCircleTextIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  CodeIcon,
  CompassIcon,
  CopyIcon,
  CopySimple,
  CpuIcon,
  CurrencyCircleDollarIcon,
  CurrencyDollarIcon,
  CursorClick,
  DatabaseIcon,
  DesktopIcon,
  DesktopTowerIcon,
  DotsThreeIcon,
  DotsThreeVerticalIcon,
  DownloadIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  FileArrowDownIcon,
  FileCodeIcon,
  FileIcon,
  FilePlusIcon,
  FilesIcon,
  FileTextIcon,
  FilmStripIcon,
  FlaskIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  FunctionIcon,
  GaugeIcon,
  GearIcon,
  GearSixIcon,
  GitBranchIcon,
  GitCommitIcon,
  GithubLogoIcon,
  GlobeIcon,
  GraphIcon,
  HardDrivesIcon,
  ImageIcon,
  ImageSquareIcon,
  InfoIcon,
  KeyboardIcon,
  LayoutIcon,
  LeafIcon,
  LightningIcon,
  LinkIcon,
  ListChecks,
  ListChecksIcon,
  ListIcon,
  LockIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  MinusCircleIcon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  PauseIcon,
  PencilSimpleIcon,
  PhoneXIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  QuestionIcon,
  Robot,
  RobotIcon,
  SelectionAll,
  ShareNetworkIcon,
  ShieldIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SparkleIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SpinnerGapIcon,
  SpinnerIcon,
  SquaresFourIcon,
  StackIcon,
  StarIcon,
  StopIcon,
  SunIcon,
  TagIcon,
  TargetIcon,
  TerminalIcon,
  TerminalWindow,
  TextAlignLeftIcon,
  TrashIcon,
  TreeStructureIcon,
  UploadSimpleIcon,
  UserCircleIcon,
  UserIcon,
  UsersIcon,
  UserSoundIcon,
  VideoCameraIcon,
  WarningCircleIcon,
  WaveformIcon,
  WifiHighIcon,
  WifiSlash,
  WifiSlashIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
