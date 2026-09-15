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
import {
  Archive, ArrowDown, ArrowLeft, ArrowUp, Ban, BookOpen, Box, Boxes, Cable, Check, ChevronDown, ChevronRight,
  CircleUser, Code, CodeXml, Command, Copy, Database, Eraser, ExternalLink, FileCog, FilePlus, Folder, FolderOpen, FolderPlus, Gauge,
  GitBranch, GitFork, Globe, Image, Keyboard, Lightbulb, ListChecks, MessageSquare, Mic, Monitor, MonitorSmartphone,
  MoreHorizontal, Moon, MessageCircleQuestionMark, MousePointerClick, Paperclip, Palette, Pause, Pencil, PenLine, Pin, Plus,
  RefreshCw, Search, Settings2, SlidersHorizontal, Split,
  SquareTerminal, Sun, Target, Terminal, Trash2, UserCog, Volume2, WandSparkles, Webhook, X,
  FastForward, CircleAlert, Clapperboard, FileText,
  Link2, Maximize2, Sparkles, Undo2, MessageSquareQuote, MessageSquarePlus, Scissors, ClipboardPaste,
  type LucideIcon,
} from 'lucide-react'
import type { Variants } from 'framer-motion'
import { fromLucide } from '@/components/icons/fromLucide'
import { McpMark } from '@/components/icons/McpMark'
import { PauseBars, PlayTriangle, SidebarToggle, StopSquare, VoiceWave } from '@/components/icons/drawn'

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
  readonly mark: LucideIcon
  readonly motion?: Variants
}

const REGISTRY = {
  // — Window and shell ----------------------------------------------------
  close: { mark: X },
  // `sidebar` is not here: it is drawn, because its motion lives inside the
  // glyph rather than on it. See `drawn.tsx`, and `Icons` below.
  search: { mark: Search },
  command: { mark: Command },
  reload: { mark: RefreshCw, motion: WIND },
  settings: { mark: Settings2, motion: TURN_SLIGHT },

  // — Conversation --------------------------------------------------------
  // A new bubble, in the bubble family the other conversation marks use.
  // It was a pen on a square, and the square's corners were the sharpest
  // shape on the strip; a conversation here is a bubble everywhere else, so
  // a new one is a bubble with a plus.
  newChat: { mark: MessageSquarePlus },
  chat: { mark: MessageSquare },
  // The stopped-run question: a permission the kernel wants or a question the
  // model asked. A speech bubble carrying a question mark -- a conversation
  // that has turned and is waiting on you -- and deliberately not the mode
  // marks, which say how far ahead the app may run rather than that it has
  // stopped.
  ask: { mark: MessageCircleQuestionMark },
  // Asking about text you selected: a bubble carrying a quotation, because
  // the selection goes into the message as one. Not `newChat`, which it used
  // to share - that mark means an empty conversation, and this one starts
  // full.
  askAbout: { mark: MessageSquareQuote },
  more: { mark: MoreHorizontal },
  openExternal: { mark: ExternalLink },
  jumpToLatest: { mark: ArrowDown, motion: { rest: { y: 0 }, hover: { y: 1.5, transition: SNAP } } },
  // Leaving the one surface whose navigation lives in the sidebar column.
  back: { mark: ArrowLeft },

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
  dropdown: { mark: ChevronDown },
  disclosure: { mark: ChevronRight, motion: TURN },

  // — Model and permission ------------------------------------------------
  //
  // The permission triad is not shields. A shield says the app is a hazard
  // being contained, which is the developer-tool reading of these modes and the
  // wrong one here: choosing "manual" is not raising a guard, it is asking to
  // be consulted. It is a transport control instead, because that is what the
  // modes actually are — how far ahead the app may run before it stops for
  // you. Pause, then write, then run on. Anyone who has used a media player can
  // read it.

  // A bulb reads as an idea arriving, which is what a reasoning run is: the
  // live event the families above reserve "thinking" for. The gauge beside it
  // is a level picked in settings, and the two must never swap jobs — a mark
  // that meant both "reasoning is happening now" and "how hard to reason"
  // would leave neither reading safe.
  thinking: { mark: Lightbulb },
  // The dial, and only the dial. Settings' Providers section used to carry it
  // too, which put the app's one picture of "how hard to think" on a row about
  // which vendors are connected — the exact collision the note at the top of
  // this file forbids.
  reasoning: { mark: Gauge },
  // Where replies come from: a set of things to draw on, not a thing to plug
  // in. `Cable` is spoken for by connectors, and MCP now carries its own
  // published mark, so `Plug` is free again -- but it still describes reach
  // rather than supply, which is why it is not the answer here either.
  providers: { mark: Boxes },
  permissionManual: { mark: Pause },
  permissionEdits: { mark: PenLine },
  permissionAuto: { mark: FastForward },

  // — Projects and source control -----------------------------------------
  project: { mark: Folder },
  projectOpen: { mark: FolderOpen },
  projectNew: { mark: FolderPlus },
  branch: { mark: GitBranch },
  worktree: { mark: GitFork },

  // — Message actions -----------------------------------------------------
  copy: { mark: Copy },
  // The text field's own verbs, for its right-click menu. Cut and paste are
  // the pair copy completes; nothing else in the app cuts or pastes.
  cut: { mark: Scissors },
  paste: { mark: ClipboardPaste },
  // Putting back what Improve did to the field. One arrow curling back -
  // not `reload`, which spins forward and means the interface starting over.
  undo: { mark: Undo2 },
  // The pencil is the edit verb wherever it is performed. The message action
  // here and the transcript's file-editing tool chip are the same concept --
  // an edit -- so they share the mark rather than splitting it by surface.
  edit: { mark: Pencil },
  fork: { mark: Split },
  readAloud: { mark: Volume2 },

  // — Tool actions ----------------------------------------------------------
  // What a tool call does: one mark per action the transcript's tool chips
  // name. Filed beside the others rather than beside the chips, so the next
  // surface that has to say "a file was written" reaches for the same mark
  // instead of growing a private one. The other verbs reuse marks already in
  // this file on purpose: the palette's `search` is a search, and a directory
  // listing is `projectOpen`'s open folder -- the shape's concept, "the
  // contents of a directory", is the same in both places.
  fileRead: { mark: BookOpen },
  fileWrite: { mark: FilePlus },
  run: { mark: Terminal },

  // — File formats ---------------------------------------------------------
  // Three formats no brand speaks for: SQL, XML and YAML are standards, not
  // companies, so the brand-mark set has nothing to borrow for them. The
  // concept's own mark stands in, by the same one-mark-one-concept rule as
  // everything in this file.
  database: { mark: Database },
  codeXml: { mark: CodeXml },
  fileCog: { mark: FileCog },

  // — Composer ------------------------------------------------------------
  add: { mark: Plus, motion: CROSS },
  attach: { mark: Paperclip },
  dictate: { mark: Mic },
  send: { mark: ArrowUp, motion: LIFT },
  // `stop`, `play` and `pause` are not here either: they are the drawn
  // transport, the one solid family in the app, and Lucide has no filled mark
  // of any kind to take them from. See `drawn.tsx`, and `Icons` below.

  // — Capabilities --------------------------------------------------------
  goal: { mark: Target },
  plan: { mark: ListChecks },
  // `mcp` is not here: MCP publishes its own mark, so it is merged in with
  // the other drawn marks at the bottom of this file. See `McpMark`.
  connector: { mark: Cable },
  skill: { mark: WandSparkles },
  hook: { mark: Webhook },
  browserUse: { mark: Globe },
  // The desktop, driven: a pointer mid-click. Not `themeSystem`'s monitor,
  // which means "follow the OS", and not `devices`, which is the same Studio
  // on two screens. This is Studio acting on the screen.
  computerUse: { mark: MousePointerClick },
  // Commands the model left running. `run` is already a terminal and means the
  // act of running something; this means the things that are still running, so
  // it is the same idea in the plural and takes a different mark rather than a
  // second copy of that one.
  backgroundJobs: { mark: SquareTerminal },

  // — Settings sections ---------------------------------------------------
  general: { mark: SlidersHorizontal },
  appearance: { mark: Palette },
  // The same Studio on a phone beside the PC: two screens, one state. Not
  // `themeSystem`, which is one monitor and means "follow the OS".
  devices: { mark: MonitorSmartphone },
  personalization: { mark: UserCog },
  shortcuts: { mark: Keyboard },
  account: { mark: CircleUser },
  coding: { mark: Code },
  archive: { mark: Archive },

  // — Appearance ----------------------------------------------------------
  themeSystem: { mark: Monitor },
  themeLight: { mark: Sun },
  themeDark: { mark: Moon },
  image: { mark: Image },

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
  video: { mark: Clapperboard },
  file: { mark: FileText },
  link: { mark: Link2 },
  generate: { mark: Sparkles },

  /* — Opening something larger ------------------------------------------
     `PanelRight` is the sidebar family: a container with an edge, meaning "a
     column of navigation appears or disappears here". The rail is not that.
     It is a details view for one thing you picked, reached from a dozen
     different places, and giving it the sidebar's mark said the button would
     toggle furniture rather than show you an object. Two arrows pushing
     outward says the thing you are pointing at gets bigger, which is what
     happens. */
  openLarger: { mark: Maximize2 },

  // — Confirmation and destructive ----------------------------------------
  check: { mark: Check },
  // Turning something off that stays installed. Not `permissionManual`, which
  // is a Pause and belongs to the execution modes: a provider you switched off
  // is not a provider waiting to be asked about.
  disable: { mark: Ban },
  failed: { mark: CircleAlert },
  pin: { mark: Pin },
  delete: { mark: Trash2, motion: LIFT_LID },
  clear: { mark: Eraser },
} satisfies Record<string, Entry>

/**
 * Fails at startup the moment two concepts point at the same mark.
 *
 * Development only. The previous registry compared drawn coordinates; with a
 * library the identity of the component is the same check, and it still catches
 * the mistake that matters — two ideas quietly sharing one shape.
 */
function assertUnique(registry: Record<string, Entry>): void {
  const seen = new Map<LucideIcon, string>()
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
      fromLucide(entry.mark, concept, (entry as Entry).motion),
    ]),
  ) as Record<keyof typeof REGISTRY, ReturnType<typeof fromLucide>>),
  sidebar: SidebarToggle,
  mcp: McpMark,
  voice: VoiceWave,
  stop: StopSquare,
  play: PlayTriangle,
  pause: PauseBars,
}

