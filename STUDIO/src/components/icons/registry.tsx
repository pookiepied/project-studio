/*
 * The icon registry: every mark in the app, bound to one concept.
 *
 * ---- The rule -------------------------------------------------------------
 *
 * One mark means one thing. Reusing a mark for two concepts is how an interface
 * stops being readable: once a shape means both "the model is thinking" and
 * "how hard it should think", neither reading is safe and the user has to fall
 * back on position to tell them apart. `assertUnique` enforces it at module
 * load in development, because this is a rule that fails silently — a
 * duplicate looks fine in the diff that adds it and only becomes confusing
 * three screens later.
 *
 * ---- The families that must not collide -----------------------------------
 *
 *   Thinking      a live event, happening now       a gauge is NOT this
 *   Reasoning     a level on a dial                 the gauge
 *   Permission    what is allowed                   the shields
 *   Model         who you are talking to            provider marks
 *
 * ---- Motion ---------------------------------------------------------------
 *
 * Narrow on purpose: a mark moves either to show a state it is now in, or to
 * preview the action it performs. Nothing moves to be charming. Hover and press
 * arrive from the control that owns the mark, so a 28px button drives the 14px
 * glyph inside it rather than the glyph having its own small hitbox.
 */
import type { IconSvgElement } from '@hugeicons/react'
import {
  Add01Icon,
  AlertCircleIcon,
  Archive02Icon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowExpand01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  BookOpen01Icon,
  BookmarkAdd01Icon,
  BubbleChatAddIcon,
  BubbleChatIcon,
  BubbleChatTemporaryIcon,
  BulbIcon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkSquare02Icon,
  ClipboardIcon,
  CodeIcon,
  CommandIcon,
  ComputerIcon,
  ComputerTerminal01Icon,
  ComputerTerminal02Icon,
  Copy01Icon,
  CpuIcon,
  Cursor01Icon,
  DashboardSpeed01Icon,
  Database01Icon,
  Delete02Icon,
  EraserIcon,
  File01Icon,
  FileScriptIcon,
  Folder01Icon,
  Folder02Icon,
  FolderAddIcon,
  FolderExportIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitForkIcon,
  Globe02Icon,
  GridViewIcon,
  Hammer01Icon,
  HeadphoneMuteIcon,
  HeadphonesIcon,
  KeyboardIcon,
  Link01Icon,
  LinkSquare02Icon,
  Layout03Icon,
  MagicWand01Icon,
  Mic01Icon,
  MicOff01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  PencilEdit01Icon,
  QuillWrite01Icon,
  PinIcon,
  PlugSocketIcon,
  Refresh01Icon,
  Robot01Icon,
  ScissorIcon,
  SpellCheckIcon,
  Search01Icon,
  SecurityCheckIcon,
  Settings02Icon,
  SlidersHorizontalIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  SparklesIcon,
  Sun01Icon,
  Tick02Icon,
  UnavailableIcon,
  Undo02Icon,
  UserCircleIcon,
  UserSettings01Icon,
  Video01Icon,
  ViewIcon,
  VolumeHighIcon,
  WebhookIcon,
  Wrench01Icon,
  AppWindowIcon,
  MinusSignIcon,
  Doc01Icon,
  FileAudioIcon,
  FileLockedIcon,
  FileVideoIcon,
  FileZipIcon,
  Pdf01Icon,
  Txt01Icon,
  Xls01Icon,
} from '@hugeicons/core-free-icons'
import { CaptureMark, ComposeMark, CursorMark, ExpandMark, HistoryMark, PanelMark, QuoteMark, ReplyMark, VsCodeMark } from '@/components/icons/familyMarks'
import {
  AudioLines,
} from 'lucide-react'
import { fromHugeicons } from '@/components/icons/fromHugeicons'
import {
  Box,
  CornerDownRight,
  GalleryVerticalEnd,
  Pause,
  FastForward,
  Focus,
  PictureInPicture2,
  FoldVertical,
  type LucideIcon,
} from 'lucide-react'
import type { Variants } from 'framer-motion'
import { fromLucide } from '@/components/icons/fromLucide'
import { McpMark } from '@/components/icons/McpMark'
import { PhotoMark } from '@/components/icons/PhotoMark'
import { AskMark, PauseBars, PlayTriangle, StopSquare, VoiceWave, WorkspaceOverviewMark } from '@/components/icons/drawn'
import { DoneMark, EraserMark, HighlighterMark, PenMark, ShareScreenMark, ShowMeMark, UndoMark } from '@/components/icons/screen'

/** The house curve for a mark reacting to the pointer. Short; this is feedback. */
const SNAP = { type: 'spring', stiffness: 520, damping: 30, mass: 0.5 } as const

/**
 * A quarter turn, used by every disclosure in the app.
 *
 * The mark rests pointing at the thing it will reveal and turns to point at the
 * thing it revealed, so the rotation is the state rather than a decoration of
 * it. One definition, so a chevron in the sidebar and a chevron in a menu can
 * never disagree about which way "open" points.
 */
const TURN: Variants = {
  rest: { rotate: 0 },
  on: { rotate: 90, transition: SNAP },
}

/** Preview of the action: the message goes up, so the mark goes up first. */
const LIFT: Variants = {
  rest: { y: 0 },
  hover: { y: -1.5, transition: SNAP },
  press: { y: -0.5, transition: SNAP },
}

/** Winds up the rotation it is about to complete. */
const WIND: Variants = {
  rest: { rotate: 0 },
  hover: { rotate: -38, transition: SNAP },
}

/** The plus becomes a cross when its menu is open — one shape, two states. */
const CROSS: Variants = {
  rest: { rotate: 0 },
  on: { rotate: 45, transition: SNAP },
}

/** A gear turns. Slight, because a full turn on hover is a toy. */
const TURN_SLIGHT: Variants = {
  rest: { rotate: 0 },
  hover: { rotate: 22, transition: SNAP },
}

/** The lid comes off before you commit — the consequence, previewed. */
const LIFT_LID: Variants = {
  rest: { y: 0 },
  hover: { y: -1, transition: SNAP },
}

interface Entry {
  /** Hugeicons data, or a Lucide mark where the free set has no match. */
  readonly mark: LucideIcon | IconSvgElement
  readonly motion?: Variants
}

const REGISTRY = {
  // — Window and shell ----------------------------------------------------
  close: { mark: Cancel01Icon },
  // `sidebar` is not here: it is a Family A mark. See `Icons` below.
  search: { mark: Search01Icon },
  command: { mark: CommandIcon },
  reload: { mark: Refresh01Icon, motion: WIND },
  settings: { mark: Settings02Icon, motion: TURN_SLIGHT },
  workArea: { mark: Layout03Icon },

  // — Conversation --------------------------------------------------------
  // A new bubble, in the bubble family the other conversation marks use.
  // It was a pen on a square, and the square's corners were the sharpest
  // shape on the strip; a conversation here is a bubble everywhere else, so
  // a new one is a bubble with a plus.
  newChat: { mark: BubbleChatAddIcon },
  chat: { mark: BubbleChatIcon },
  temporaryChat: { mark: BubbleChatTemporaryIcon },
  // `ask` is not here: the stopped-run question is a drawn bare question mark
  // (`AskMark` in `drawn.tsx`), merged in below. Deliberately not the mode
  // marks, which say how far ahead the app may run rather than that it has
  // stopped.
  // One answer a stopped run offers: the arrow at the start of each row on a
  // question or permission card, saying "this way" rather than "open".
  choose: { mark: ArrowRight02Icon },
  // Asking about text you selected: a bubble carrying a quotation, because
  // the selection goes into the message as one. Not `newChat`, which it used
  // to share - that mark means an empty conversation, and this one starts
  // full.
  more: { mark: MoreHorizontalIcon },
  openExternal: { mark: LinkSquare02Icon },
  // A link's own way out: the bare arrow, lighter than the boxed mark,
  // for the one-button pill a plain link opens.
  openLink: { mark: ArrowUpRight01Icon },
  jumpToLatest: { mark: ArrowDown02Icon, motion: { rest: { y: 0 }, hover: { y: 1.5, transition: SNAP } } },
  // Leaving the one surface whose navigation lives in the sidebar column.
  back: { mark: ArrowLeft02Icon },

  // — There is more here --------------------------------------------------
  //
  // Two marks for two places the "more" can be. `disclosure` reveals it in
  // the flow - a tree row's children, a thinking block's text, a breakdown
  // under its figure - and turns to point at what it revealed, because the
  // content moves the page and the mark should say which way. `dropdown`
  // opens something that floats over the page - a menu, a popover - and
  // does not turn, because nothing below it moved and the trigger is still
  // where it was. A reader can tell them apart by whether the page got
  // longer; the marks should agree with the page.
  dropdown: { mark: ArrowDown01Icon },
  disclosure: { mark: ArrowRight01Icon, motion: TURN },

  // — Model and permission ------------------------------------------------
  //
  // The permission pair is not shields. A shield says the app is a hazard
  // being contained, which is the developer-tool reading of these modes and the
  // wrong one here: choosing "ask" is not raising a guard, it is asking to
  // be consulted. It is a transport control instead, because that is what the
  // modes actually are — how far ahead the app may run before it stops for
  // you. Pause, or run on. Anyone who has used a media player can read it.
  // The pen that sat between them went with the third mode (ADR 0057).

  // A bulb reads as an idea arriving, which is what a reasoning run is: the
  // live event the families above reserve "thinking" for. The gauge beside it
  // is a level picked in settings, and the two must never swap jobs — a mark
  // that meant both "reasoning is happening now" and "how hard to reason"
  // would leave neither reading safe.
  thinking: { mark: BulbIcon },
  // The dial, and only the dial. Settings' Providers section used to carry it
  // too, which put the app's one picture of "how hard to think" on a row about
  // which vendors are connected — the exact collision the note at the top of
  // this file forbids.
  reasoning: { mark: DashboardSpeed01Icon },
  // Where replies come from: the machine that answers. It was a stack of
  // boxes - a set of things to draw on - which read as storage or shipping
  // and never as a model; a brain was tried and is too intricate for the
  // sizes this app draws marks at. `Cable` is spoken for by connectors, and
  // MCP carries its own published mark, so `Plug` is free -- but it
  // describes reach rather than supply, which is why it is not the answer
  // here either.
  providers: { mark: CpuIcon },
  // The full catalog, one step behind the picker: a grid of tiles, a place
  // to browse rather than a thing to find. It was the palette's search
  // glass, which promised a search box and opened a page; a bookshelf was
  // tried and is too fine a drawing for a menu row.
  library: { mark: GridViewIcon },
  // What a model can do, as a row states it. Two of the three are new marks
  // here: a hammer for tool calling, an eye for vision. Reasoning is the
  // bulb the transcript already uses for a reasoning run - the same idea at
  // rest - and not the gauge, which means how hard to reason, a setting.
  toolCalling: { mark: Hammer01Icon },
  vision: { mark: ViewIcon },
  permissionAsk: { mark: Pause },
  permissionAuto: { mark: FastForward },

  // — Projects and source control -----------------------------------------
  project: { mark: Folder01Icon },
  projectOpen: { mark: Folder02Icon },
  projectNew: { mark: FolderAddIcon },
  branch: { mark: GitBranchIcon },
  worktree: { mark: GitForkIcon },
  // Where a conversation was compacted: two arrows closing on a line, the
  // transcript folding to its summary. Plain enough to sit in a transcript
  // row at caption size.
  compaction: { mark: FoldVertical },
  // "Keep in the library": a bookmark with a plus, on a thumbnail and on
  // a generated picture, for the one act the library begins with.
  keep: { mark: BookmarkAdd01Icon },

  // — Message actions -----------------------------------------------------
  copy: { mark: Copy01Icon },
  // The text field's own verbs, for its right-click menu. Cut and paste are
  // the pair copy completes; nothing else in the app cuts or pastes.
  cut: { mark: ScissorIcon },
  paste: { mark: ClipboardIcon },
  // A suggested correction in the text field's menu.
  spelling: { mark: SpellCheckIcon },
  // Putting back what Improve did to the field. One arrow curling back -
  // not `reload`, which spins forward and means the interface starting over.
  undo: { mark: Undo02Icon },
  // The pencil is the edit verb wherever it is performed. The message action
  // here and the transcript's file-editing tool chip are the same concept --
  // an edit -- so they share the mark rather than splitting it by surface.
  edit: { mark: PencilEdit01Icon },
  fork: { mark: GitCompareIcon },
  readAloud: { mark: VolumeHighIcon },

  // — Tool actions ----------------------------------------------------------
  // What a tool call does: one mark per action the transcript's tool chips
  // name. Filed beside the others rather than beside the chips, so the next
  // surface that has to say "a file was written" reaches for the same mark
  // instead of growing a private one. The other verbs reuse marks already in
  // this file on purpose: the palette's `search` is a search, and a directory
  // listing is `projectOpen`'s open folder -- the shape's concept, "the
  // contents of a directory", is the same in both places.
  fileRead: { mark: BookOpen01Icon },
  // A quill, because writing a file is authorship and the pencil is already the
  // edit. A page with a corner plus reads as an insect at row size.
  fileWrite: { mark: QuillWrite01Icon },
  // Editors a file can open in, by their own logos. See `familyMarks.ts`.
  editorVsCode: { mark: VsCodeMark },
  editorCursor: { mark: CursorMark },
  run: { mark: ComputerTerminal01Icon },
  // A file going into a folder: the move tool, whose whole act is a file
  // gaining a new place. Not the pencil, which is an edit to a file's
  // contents; nothing here changes what is inside the file.
  move: { mark: FolderExportIcon },

  // — File formats ---------------------------------------------------------
  // Three formats no brand speaks for: SQL, XML and YAML are standards, not
  // companies, so the brand-mark set has nothing to borrow for them. The
  // concept's own mark stands in, by the same one-mark-one-concept rule as
  // everything in this file.
  database: { mark: Database01Icon },
  codeXml: { mark: SourceCodeIcon },
  fileCog: { mark: FileScriptIcon },

  // — Composer ------------------------------------------------------------
  add: { mark: Add01Icon, motion: CROSS },
  subtract: { mark: MinusSignIcon },
  dictate: { mark: Mic01Icon },
  // The microphone held closed in voice mode: nothing is recorded or sent.
  muted: { mark: MicOff01Icon },
  // Hearing the voice, and not: deafen silences Studio's speech on a call.
  listen: { mark: HeadphonesIcon },
  deafened: { mark: HeadphoneMuteIcon },
  send: { mark: ArrowUp02Icon, motion: LIFT },
  steer: { mark: CornerDownRight },
  queue: { mark: GalleryVerticalEnd },
  // `stop`, `play` and `pause` are not here either: they are the drawn
  // transport, the one solid family in the app, and Lucide has no filled mark
  // of any kind to take them from. See `drawn.tsx`, and `Icons` below.

  // — Capabilities --------------------------------------------------------
  plan: { mark: CheckListIcon },
  // `mcp` is not here: MCP publishes its own mark, so it is merged in with
  // the other drawn marks at the bottom of this file. See `McpMark`.
  connector: { mark: PlugSocketIcon },
  skill: { mark: MagicWand01Icon },
  hook: { mark: WebhookIcon },
  // The agent roster's section mark: the delegate itself. Not `sparkles`
  // (generation) and not `skill` (a skill's wand) — the agents pane is the
  // one place that names the agents rather than one of their surfaces.
  agents: { mark: Robot01Icon },
  browserUse: { mark: Globe02Icon },
  // The desktop, driven: a pointer mid-click. Not `themeSystem`'s monitor,
  // which means "follow the OS", and not `devices`, which is the same Studio
  // on two screens. This is Studio acting on the screen.
  computerUse: { mark: Cursor01Icon },
  // Commands the model left running. `run` is already a terminal and means the
  // act of running something; this means the things that are still running, so
  // it is the same idea in the plural and takes a different mark rather than a
  // second copy of that one.
  backgroundJobs: { mark: ComputerTerminal02Icon },

  // — Settings sections ---------------------------------------------------
  general: { mark: SlidersHorizontalIcon },
  appearance: { mark: PaintBoardIcon },
  // The same Studio on a phone beside the PC: two screens, one state. Not
  // `themeSystem`, which is one monitor and means "follow the OS".
  devices: { mark: SmartPhone01Icon },
  personalization: { mark: UserSettings01Icon },
  shortcuts: { mark: KeyboardIcon },
  account: { mark: UserCircleIcon },
  coding: { mark: CodeIcon },
  archive: { mark: Archive02Icon },
  // Permissions: the standing rules themselves. A shield here is right —
  // the chat's ask/auto pair deliberately is not one (choosing "ask" is a
  // request, not a wall) — because this page is the wall, seen from the
  // side that owns it.
  permissions: { mark: SecurityCheckIcon },
  // The retrieval vendors a run can call on - web search and page fetch.
  // A wrench, because the page is named Tools and the mark should agree
  // with the name; it was the search glass, which said "a search box" about
  // a page of keys.
  tools: { mark: Wrench01Icon },

  // — Appearance ----------------------------------------------------------
  themeSystem: { mark: ComputerIcon },
  themeLight: { mark: Sun01Icon },
  themeDark: { mark: Moon02Icon },
  image: { mark: PhotoMark },

  // — Artifacts -----------------------------------------------------------
  // Marks for things the model produced. `image` already exists above and is
  // deliberately not repeated here.
  //
  // `artifact` is the one every kind falls back to, and it used to be `goal`.
  // That put the app's picture of "a standing aim for this conversation" on the
  // rail tab, the generic renderer and the arriving placeholder — a target
  // beside a piece of mail — so the mark meant an intention in one place and a
  // produced object in three others. A plain container is the fallback because
  // the fallback's whole claim is that it does not know what is inside.
  artifact: { mark: Box },
  fitMap: { mark: Focus },
  video: { mark: Video01Icon },
  file: { mark: File01Icon },
  // A file's kind, where no language's mark applies. See `fileTypes`.
  fileExecutable: { mark: AppWindowIcon },
  fileZip: { mark: FileZipIcon },
  filePdf: { mark: Pdf01Icon },
  fileAudio: { mark: FileAudioIcon },
  fileVideo: { mark: FileVideoIcon },
  fileText: { mark: Txt01Icon },
  fileSheet: { mark: Xls01Icon },
  fileDocument: { mark: Doc01Icon },
  fileSecret: { mark: FileLockedIcon },
  link: { mark: Link01Icon },
  generate: { mark: SparklesIcon },

  /* — Opening something larger ------------------------------------------
     `PanelRight` is the sidebar family: a container with an edge, meaning "a
     column of navigation appears or disappears here". The rail is not that.
     It is a details view for one thing you picked, reached from a dozen
     different places, and giving it the sidebar's mark said the button would
     toggle furniture rather than show you an object. Two arrows pushing
     outward says the thing you are pointing at gets bigger, which is what
     happens. */
  openLarger: { mark: ArrowExpand01Icon },
  // Folding a surface into the corner player it keeps running in. The mark is
  // that picture - a small window in a large one - rather than arrows, so it
  // sits beside a "Leave" label without the two pointing different ways.
  minimize: { mark: PictureInPicture2 },

  // — Confirmation and destructive ----------------------------------------
  check: { mark: Tick02Icon },
  // Selecting several at once — the library's select mode. A box with the
  // mark inside it, because what the mode does is put exactly that beside
  // every card.
  select: { mark: CheckmarkSquare02Icon },
  // Turning something off that stays installed. Not `permissionAsk`, which
  // is a Pause and belongs to the execution modes: a provider you switched off
  // is not a provider waiting to be asked about.
  disable: { mark: UnavailableIcon },
  failed: { mark: AlertCircleIcon },
  pin: { mark: PinIcon },
  delete: { mark: Delete02Icon, motion: LIFT_LID },
  clear: { mark: EraserIcon },
} satisfies Record<string, Entry>

/**
 * Fails at startup the moment two concepts point at the same mark.
 *
 * Development only. The previous registry compared drawn coordinates; with a
 * library the identity of the component is the same check, and it still catches
 * the mistake that matters — two ideas quietly sharing one shape.
 */
function assertUnique(registry: Record<string, Entry>): void {
  const seen = new Map<Entry['mark'], string>()
  for (const [concept, entry] of Object.entries(registry)) {
    const previous = seen.get(entry.mark)
    if (previous) {
      throw new Error(
        `Icon collision: "${concept}" uses the same mark as "${previous}". ` +
          'One mark means one concept -- pick a different mark or merge the concepts.',
      )
    }
    seen.set(entry.mark, concept)
  }
}

if (import.meta.env.DEV) assertUnique(REGISTRY)

// The concept union now comes from `Icons`, which is REGISTRY plus the drawn marks.

/**
 * Concept name to component. Consumers import from here, never a raw mark.
 *
 * The drawn marks are merged in at this line and nowhere else, so a call site
 * cannot tell which renderer is behind `Icons.sidebar` — both accept the same
 * `size` and `state` and both read `IconStateContext`. That is the point of the
 * registry being a map of concepts: the renderer is an implementation detail
 * that can differ per mark without leaking into the app.
 */
export const Icons = {
  ...(Object.fromEntries(
    Object.entries(REGISTRY).map(([concept, entry]) => [
      concept,
      Array.isArray(entry.mark)
        ? fromHugeicons(entry.mark, concept, (entry as Entry).motion)
        : fromLucide(entry.mark as LucideIcon, concept, (entry as Entry).motion),
    ]),
  ) as Record<keyof typeof REGISTRY, ReturnType<typeof fromLucide>>),
  // The composer's marks, as Family A draws them (see `fromHugeicons.tsx`).
  paperclip: fromHugeicons(Attachment01Icon, 'paperclip'),
  web: fromHugeicons(Globe02Icon, 'web'),
  dots: fromHugeicons(MoreHorizontalIcon, 'dots'),
  // Lucide's, because the free Hugeicons waveforms are too dense at this size.
  waveform: fromLucide(AudioLines, 'waveform'),
  sendUp: fromHugeicons(ArrowUp02Icon, 'sendUp', LIFT),
  reply: fromHugeicons(ReplyMark, 'reply'),
  quote: fromHugeicons(QuoteMark, 'quote'),
  // The header's marks.
  history: fromHugeicons(HistoryMark, 'history'),
  compose: fromHugeicons(ComposeMark, 'compose'),
  capture: fromHugeicons(CaptureMark, 'capture'),
  expand: fromHugeicons(ExpandMark, 'expand'),
  windowClose: fromHugeicons(Cancel01Icon, 'windowClose'),
  sidebar: fromHugeicons(PanelMark, 'sidebar'),
  workspace: WorkspaceOverviewMark,
  mcp: McpMark,
  voice: VoiceWave,
  ask: AskMark,
  stop: StopSquare,
  play: PlayTriangle,
  pause: PauseBars,
  // The screen family (`screen.tsx`): one hand for the drawing toolbar, so
  // its undo and done are drawn there too rather than borrowed from the
  // library's `undo` and `check`, which they sit beside nowhere else.
  shareScreen: ShareScreenMark,
  showMe: ShowMeMark,
  inkPen: PenMark,
  inkHighlighter: HighlighterMark,
  inkErase: EraserMark,
  inkUndo: UndoMark,
  inkDone: DoneMark,
}

