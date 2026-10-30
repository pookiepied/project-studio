import { ComputerError } from "./errors.js";
import { requestBudget, type ComputerSession } from "./session.js";
import { captureChanges, refusalMessage, withBatchFrame, type Actor, type DesktopControl, type DesktopState } from "./control.js";
import { describeObservation, frontFrom, pointerFrom, staleReasons, type Pointer } from "./observations.js";
import { createStudioUuid } from "../contracts/uuid.js";
import { displaysFrom, markSet } from "./marks.js";
import { AFTER_ACTION_SIDE_PX, SCREENSHOT_MAX_BYTES, SCREENSHOT_SIDE_PX } from "../contracts/media-limits.js";

/**
 * The tools, as the model sees them.
 *
 * Thirty, named `studio_computer_*`, and each one earns its schema with
 * a job the capability exists for: see what is on screen, point and click,
 * type, find and drive windows, read a window's controls and act on them by
 * reference, read or write the clipboard, take or give back the one
 * desktop (`control`, ADR 0059), and point things out to the person
 * without touching anything (`mark`). The list a person handed over
 * as "the common pattern" had thirty; the difference is folding (ADR 0013,
 * one tool per capability): five kinds of click are one `click` with a
 * button and a count, two mouse-button tools are one, two clipboard tools
 * are one, and "switch display" is an argument on the picture it applies to.
 *
 * Two conventions run through all of them. **Coordinates are the display's
 * physical pixels**, and every picture says which frame it stands for, so a
 * model reads the frame and never the picture's own size. Every picture and
 * every read also carries a `frameId`, and a point names the one it was read
 * from: the lease refuses a point from a frame the caller was not given, one
 * older than the latest change, or one of another display (`control.ts`). **A control is
 * addressed by a ref from `read_ui`**, which is the reliable way, or by a
 * coordinate when there is nothing to reference - a canvas, a game, a window
 * that exposes no accessibility tree. A ref stays good across Studio's own
 * input while its control exists; the driver refuses a stale one. **Several
 * steps go in one `batch`**, which runs them in order, stops at the first
 * failure and answers with one picture: a model turn costs seconds, a step
 * a few hundred milliseconds.
 */

export interface ToolAnswer {
  readonly content: readonly { readonly type: string; readonly [key: string]: unknown }[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

/** Who is calling and the lease they call under; only the control tool reads it. */
export interface ToolContext {
  readonly actor: Actor;
  readonly desktop: DesktopControl;
  readonly signal?: AbortSignal | undefined;
  /** The person approved text for a password field in this call (P1-4); a model can never set it. */
  readonly allowPassword?: boolean;
  /**
   * Checks one batch step against the person's approvals before it is sent:
   * a refusal sentence when the step needs asking, or what it may do.
   */
  readonly gate?: (tool: string, args: Record<string, unknown>) => Promise<{ readonly refusal?: string; readonly allowPassword?: boolean }>;
}

/**
 * What a call's input would reach that Studio asks the person about first
 * (P1-4): a category known from the arguments, or a probe for the driver to
 * say which process the input would land in. Moving and scrolling are left
 * out; they change nothing an app acts on.
 */
export type Reach = { readonly category: "open_path" | "clipboard_read" } | { readonly probe: Record<string, unknown> };

export function reachOf(tool: string, args: Record<string, unknown>, context?: ToolContext): Reach | undefined {
  const point = (x: unknown, y: unknown): Reach => {
    const frameId = str(args, "frameId");
    const shown = frameId === undefined || context === undefined ? undefined : context.desktop.frameDisplays(context.actor, frameId);
    const display = num(args, "display") ?? (shown?.length === 1 ? shown[0] : undefined);
    return { probe: { kind: "point", x, y, display: display ?? "" } };
  };
  switch (tool.replace(/^studio_computer_/, "")) {
    case "click": return point(args["x"], args["y"]);
    case "drag": return Array.isArray(args["from"]) ? point(args["from"][0], args["from"][1]) : undefined;
    case "mouse_button": return args["action"] === "down" ? { probe: { kind: "pointer" } } : undefined;
    case "type": return { probe: { kind: "keys", text: true } };
    case "key": return { probe: { kind: "keys" } };
    // Letting go is never asked about: it is how input stops.
    case "hold_key": return args["action"] === "up" ? undefined : { probe: { kind: "keys" } };
    case "act":
    case "set_value":
    case "select_text": return typeof args["ref"] === "string" ? { probe: { kind: "ref", ref: args["ref"] } } : undefined;
    case "open": return str(args, "path") === undefined ? undefined : { category: "open_path" };
    case "clipboard": return args["action"] === "read" ? { category: "clipboard_read" } : args["action"] === "paste" ? { probe: { kind: "keys", text: true } } : undefined;
    default: return undefined;
  }
}

/**
 * What a tool does to the desktop, in the kernel's words. `read` looks and
 * sends no input; `write` sends input or changes what the person's screen
 * shows; `execute` starts programs or moves data across applications
 * (`open`, the clipboard). Published on each definition as MCP annotations;
 * the harness still admits every computer tool under the server's own
 * effects, so a label never loosens a permission by itself.
 */
export type ToolEffect = "read" | "write" | "execute";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly inputSchema: Record<string, unknown>;
  readonly run: (session: ComputerSession, input: Record<string, unknown>, context?: ToolContext) => Promise<ToolAnswer>;
}

function object(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
    additionalProperties: false,
  };
}

const NUMBER = { type: "number" } as const;
const STRING = { type: "string" } as const;

const DISPLAY = {
  display: {
    type: "number",
    description:
      "Which display, by the index from `displays`. Defaults to the display of the window being worked in, " +
      "else the pointer's, else the primary.",
  },
} as const;

const POINT = {
  x: { type: "number", description: "Pixels from the left edge of the display." },
  y: { type: "number", description: "Pixels from the top edge of the display." },
} as const;

const FRAME = {
  frameId: {
    type: "string",
    description:
      "The frameId of the picture or read_ui the point was read from: a screenshot, a zoom, the picture after an action. " +
      "A point from a frame you were not given, one older than the latest change, or one of another display is refused before anything is sent.",
  },
} as const;

const MODIFIERS = {
  modifiers: {
    type: "string",
    description: 'Keys to hold during the action, joined with "+": "ctrl", "shift", "ctrl+shift", "alt".',
  },
} as const;

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function required(input: Record<string, unknown>, key: string): string {
  const value = str(input, key);
  if (value === undefined) {
    throw new ComputerError("bad_input", { message: `Give a value for "${key}".` });
  }
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = num(input, key);
  if (value === undefined) {
    throw new ComputerError("bad_input", { message: `Give a number for "${key}".` });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(body: string): { type: "text"; text: string } {
  return { type: "text", text: body };
}

function answer(body: string): ToolAnswer {
  return { content: [text(body)] };
}

function actionAnswer(body: string, result: unknown): ToolAnswer {
  const observation = isRecord(result) && isRecord(result["observation"]) ? result["observation"] : null;
  if (observation === null) return answer(body);
  const lines = [body, "Input was dispatched; the intended application result is not verified."];
  if (observation["available"] !== true) {
    lines.push("Post-action observation is unavailable. Get status and read the intended window before further input. Do not replay the action automatically.");
  } else {
    for (const [field, label] of [["target", "Target"], ["front", "In front"]] as const) {
      const row = observation[field];
      if (isRecord(row)) lines.push(`${label}: ${windowLine(row)}.`);
    }
    if (observation["returnedToOwner"] === true) lines.push("The dialog being worked in has closed; the work is back in the window that raised it.");
    if (observation["targetGone"] === true) lines.push("The previous target has closed or changed identity. Choose the intended replacement explicitly; foreground alone is not authority to continue.");
    for (const [field, label] of [["newWindows", "Opened"], ["closedWindows", "Closed"], ["candidates", "Recovery candidate"]] as const) {
      const rows = observation[field];
      if (Array.isArray(rows)) for (const row of rows) if (isRecord(row)) lines.push(`${label}: ${windowLine(row)}.`);
    }
    if (observation["truncated"] === true) lines.push("Window changes were truncated; list windows for the current inventory.");
    lines.push(observation["refsInvalidated"] === false
      ? "References from the latest read_ui still work while their controls exist; a stale one is refused, then read_ui again. Never repeat input just because verification is unavailable."
      : "Previous UI references are invalid. Observe the result and call read_ui again before using a control reference. Never repeat input just because verification is unavailable.");
  }
  return { content: [text(lines.join("\n"))], structuredContent: { observation } };
}

/** Sessions inside a batch: their steps answer without a picture; the batch takes one at the end. */
const batching = new WeakSet<ComputerSession>();

/**
 * What a batch may run. Seeing is the batch's own last picture; Stop and
 * batch itself stay outside. `mouse_button` and `arrange` are in: a held
 * press between moves, and a window maximized before the clicks in it, are
 * the steps a batch exists for. `clipboard` stays out: it moves data across
 * applications, and a read is put to the person on its own.
 */
const BATCH_STEPS = new Set([
  "move", "click", "drag", "mouse_button", "scroll", "type", "key", "hold_key", "open", "focus", "arrange",
  "wait_for_window", "read_ui", "act", "set_value", "select_text", "wait",
]);

/** The longest a batch's steps may take together, inside the harness's two-minute call deadline. */
const BATCH_MAX_MS = 100_000;

/** The most steps one batch runs. */
const BATCH_MAX_STEPS = 20;

/** The most a batch step may take, from the driver's own budgets; a wait is its seconds. */
function stepBudget(step: string, args: Record<string, unknown>): number {
  const seconds = typeof args["seconds"] === "number" && Number.isFinite(args["seconds"]) ? Math.max(0, args["seconds"]) : 0;
  switch (step) {
    case "wait": return Math.min(seconds, 30) * 1000;
    case "wait_for_window": return requestBudget("wait_window", args);
    case "hold_key": return args["action"] === undefined ? requestBudget("hold", args) : requestBudget("key_toggle");
    case "mouse_button": return requestBudget("button");
    default: return requestBudget(step, args);
  }
}

/** A step's receipt without the lines every receipt repeats; the batch says those once. */
function stepLines(answer: ToolAnswer): string {
  return answer.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block["text"] === "string")
    .map((block) => block.text.split("\n").filter((line) =>
      !line.startsWith("Input was dispatched;") && !line.startsWith("References from the latest") && !line.startsWith("Previous UI references")).join("\n"))
    .join("\n");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Picture {
  readonly display: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly mimeType: string;
  readonly data: string;
  /** Set when the driver sent a JPEG or a smaller picture to stay within budget. */
  readonly note?: string;
}


function asPicture(value: unknown): Picture {
  if (!isRecord(value) || typeof value["data"] !== "string") {
    throw new ComputerError("internal", { message: "The driver answered a picture without an image." });
  }
  return value as unknown as Picture;
}

/** The most controls one read lists, so a read's structure stays within what one answer may carry. */
const READ_UI_MAX_LIMIT = 1000;

function capped(value: unknown, length: number): string {
  return typeof value === "string" ? value.slice(0, length) : "";
}

/**
 * A read's controls as structure, one record each, built only from the
 * fields the driver is meant to send. A password field's value is replaced
 * here as well as in the driver: what reaches a result reaches the model's
 * context and its transcript, and one check missing is one leak.
 */
function elementsFrom(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, READ_UI_MAX_LIMIT).filter(isRecord).map((element) => {
    const center = isRecord(element["center"]) ? element["center"] : {};
    const password = element["password"] === true;
    const patterns: unknown[] = Array.isArray(element["patterns"]) ? element["patterns"] : [];
    return {
      ref: capped(element["ref"], 80),
      role: capped(element["role"], 64),
      name: capped(element["name"], 120),
      ...(password ? { value: "[password]" } : typeof element["value"] === "string" ? { value: element["value"].slice(0, 60) } : {}),
      password,
      patterns: patterns.filter((pattern): pattern is string => typeof pattern === "string").slice(0, 24).map((pattern) => pattern.slice(0, 40)),
      display: typeof element["display"] === "number" ? element["display"] : null,
      center: { x: typeof center["x"] === "number" ? center["x"] : null, y: typeof center["y"] === "number" ? center["y"] : null },
      automationId: capped(element["automationId"], 120),
      className: capped(element["className"], 120),
      runtimeId: capped(element["runtimeId"], 80),
      enabled: element["enabled"] !== false,
      focused: element["focused"] === true,
      ...(element["checked"] === true ? { checked: true } : {}),
    };
  });
}

/** The sentence that makes a picture usable: which frame its pixels stand for. */
function frameLine(picture: Picture): string {
  const region =
    picture.x === 0 && picture.y === 0 && picture.width === picture.frameWidth && picture.height === picture.frameHeight
      ? `the whole display, ${String(picture.frameWidth)}x${String(picture.frameHeight)} pixels`
      : `the region from (${String(picture.x)},${String(picture.y)}) ${String(picture.width)}x${String(picture.height)} of a ${String(picture.frameWidth)}x${String(picture.frameHeight)} display`;
  const scaled =
    picture.imageWidth === picture.width
      ? ""
      : ` The image is ${String(picture.imageWidth)}x${String(picture.imageHeight)}; coordinates you give are in the display's pixels, not the image's.`;
  const note = picture.note === undefined ? "" : ` ${picture.note}`;
  return `Display ${String(picture.display)}: ${region}.${scaled}${note}`;
}

interface Taken {
  readonly line: string;
  readonly image: { type: "image"; data: string; mimeType: string };
  readonly pointer: Pointer | null;
  /** The frame as structure: what a caller's coordinates may name. Never the pixels. */
  readonly frame: Record<string, unknown>;
}

async function picture(session: ComputerSession, args: Record<string, unknown>): Promise<Taken> {
  // Sampled before the pixels: a change while they are taken leaves the frame stale.
  const changes = captureChanges();
  const raw = await session.request("screenshot", { ...args, budget: SCREENSHOT_MAX_BYTES });
  return framed(session, raw, createStudioUuid(), changes);
}

/**
 * A captured picture made a frame: remembered as the conversation's latest
 * observation, offered to its caller as a frame under `id`, and said with
 * the id a point must name. `displays` adds any a read in the same
 * observation placed controls on.
 */
function framed(session: ComputerSession, raw: unknown, id: string, changes: number | undefined, displays: readonly number[] = []): Taken {
  const shot = asPicture(raw);
  const pointer = isRecord(raw) ? pointerFrom(raw["pointer"]) : null;
  session.rememberFrame({ display: shot.display, width: shot.frameWidth, height: shot.frameHeight });
  session.offerObservation({
    id, capturedAt: Date.now(), display: shot.display,
    frame: { width: shot.frameWidth, height: shot.frameHeight },
    region: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
    image: { width: shot.imageWidth, height: shot.imageHeight, mimeType: shot.mimeType },
    pointer,
    front: isRecord(raw) ? frontFrom(raw["front"]) : null,
    data: shot.data,
  });
  // A window's own drawing may differ from the screen where it is covered,
  // so it is evidence to read, never a frame a point may be taken from.
  const ownDrawing = isRecord(raw) && raw["captureMode"] === "window";
  if (changes !== undefined && !ownDrawing) session.offerFrame({ id, displays: [shot.display, ...displays], changes });
  return {
    line: ownDrawing ? `${frameLine(shot)}\n${windowCaptureLine(raw)}` : `${frameLine(shot)}\nframeId: ${id}`,
    image: { type: "image", data: shot.data, mimeType: shot.mimeType },
    pointer,
    frame: {
      id, display: shot.display, width: shot.frameWidth, height: shot.frameHeight,
      region: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
      image: { width: shot.imageWidth, height: shot.imageHeight, mimeType: shot.mimeType },
    },
  };
}

/** What a window capture is, said where its frameId would be. */
function windowCaptureLine(raw: Record<string, unknown>): string {
  const lines = ["Captured from the window's own drawing (capture_mode window), not from the screen: where another window covers it, the screen shows that one instead. This picture is not a frame; take a display picture before pointing at anything in it."];
  if (raw["blank"] === true || raw["printed"] === false) {
    lines.push("The capture came back blank: this app draws with the GPU (a browser or a game, usually), which window capture cannot see. Use capture_mode display with the window in front.");
  }
  return lines.join(" ");
}

function pointerLine(pointer: Pointer | null): string {
  return pointer === null ? "" : `Pointer at (${String(pointer.x)},${String(pointer.y)}) on display ${String(pointer.display)}.`;
}

/** The process a window was listed for, when the call names it. */
function identityArgs(input: Record<string, unknown>): Record<string, unknown> {
  const pid = num(input, "pid");
  return pid === undefined ? {} : { pid, processStarted: str(input, "processStarted") ?? "" };
}

/**
 * The frame a point names, and the display it lands on: the one given, else
 * the frame's own. A display the driver chose by default (the target's, the
 * pointer's) is right only by luck when the picture was of another display.
 */
function framedPoint(input: Record<string, unknown>, context: ToolContext | undefined): Record<string, unknown> {
  const frameId = str(input, "frameId");
  if (frameId === undefined) {
    throw new ComputerError("bad_input", { message: "Give the frameId of the picture the point was read from. No input was sent." });
  }
  const display = num(input, "display");
  if (display !== undefined) return { display };
  const shown = context?.desktop.frameDisplays(context.actor, frameId);
  return shown?.length === 1 ? { display: shown[0] } : {};
}

/**
 * The ordinary answer from a tool that did something: what happened, where
 * the pointer is, and a picture of the display it acted on. The picture is a
 * JPEG scaled to 1280, the same trade the browser makes: "did it land" is
 * answered as well by a small frame as by a large one, and a tool exists for
 * the times a real screenshot is the point.
 */
async function acted(session: ComputerSession, said: string, display: unknown, result?: unknown): Promise<ToolAnswer> {
  const receipt = actionAnswer(said, result);
  if (batching.has(session)) return receipt;
  try {
    // The pointer comes back with the pixels, sampled in the same driver
    // operation: one round trip, and the two never disagree.
    const shot = await picture(session, {
      ...(typeof display === "number" ? { display } : {}),
      max: AFTER_ACTION_SIDE_PX,
      format: "jpeg",
    });
    const where = pointerLine(shot.pointer);
    return {
      ...receipt,
      content: [...receipt.content, text(where === "" ? shot.line : `${where}\n${shot.line}`), shot.image],
      structuredContent: { ...receipt.structuredContent, frame: shot.frame },
    };
  } catch {
    // A frame that could not be taken is not a reason to fail the click
    // that worked; the words still say what happened.
    return { ...receipt, content: [...receipt.content, text("The post-action screenshot is unavailable. Input may already have taken effect; get status before continuing and do not automatically repeat it.")] };
  }
}

/**
 * What was said, plus the driver's note when another window came to the
 * front while the keys were going out. The driver checks the target before
 * it sends and again after; keys already sent cannot be recalled, so the
 * note says where the later ones landed instead of letting "Typed 57
 * characters" stand for text that reached nothing.
 */
function withFront(said: string, sent: unknown): string {
  return withNote(said, sent, "front");
}

/** What was said, plus a named note from the driver's answer when there is one. */
function withNote(said: string, sent: unknown, key: string): string {
  const note = isRecord(sent) && typeof sent[key] === "string" ? sent[key] : "";
  return note === "" ? said : `${said} ${note}`;
}

/** One window, as status and arrange describe it: name, app, display, place, state. */
function windowLine(row: Record<string, unknown>): string {
  const state = [row["minimized"] === true ? "minimized" : "", row["maximized"] === true ? "maximized" : ""].filter((s) => s !== "");
  return (
    `${windowName(row)} (${String(row["app"])}) on display ${String(row["display"])}, ` +
    `${String(row["width"])}x${String(row["height"])} at (${String(row["x"])},${String(row["y"])})` +
    (state.length === 0 ? "" : `, ${state.join(", ")}`)
  );
}

/** Where the work is, as status says it: the working window, what is in front, the pointer, the displays. */
function statusLines(status: Record<string, unknown>): string {
  const lines: string[] = [];
  const target = status["target"];
  if (isRecord(target)) {
    lines.push(`Working in: ${windowLine(target)}.`);
    lines.push(
      status["targetInFront"] === true
        ? "It is the window in front; keys and text will reach it."
        : "It is NOT the window in front; keys and text would be refused. Focus it, or click inside it, first.",
    );
  } else if (status["targetGone"] === true) {
    lines.push("The window being worked in has closed. Open, focus, read or click in a window to choose another.");
  } else {
    lines.push("No window has been chosen to work in yet. Open, focus, read or click in one.");
  }
  const front = status["front"];
  if (isRecord(front) && !(isRecord(target) && front["handle"] === target["handle"])) {
    lines.push(`In front: ${windowLine(front)}.`);
  }
  const lock = status["foregroundLock"];
  if (isRecord(lock)) {
    lines.push(lock["likely"] === true
      ? "Windows should let Studio bring a window to the front now."
      : `Windows may refuse to bring a window to the front: ${String(lock["reason"])}.`);
  }
  const cursor = status["cursor"];
  if (isRecord(cursor)) {
    lines.push(`Pointer at (${String(cursor["x"])},${String(cursor["y"])}) on display ${String(cursor["display"])}.`);
  }
  const displays = status["displays"];
  if (Array.isArray(displays)) {
    lines.push(
      `Displays: ${displays
        .map((d: unknown) =>
          isRecord(d) ? `${String(d["index"])} (${String(d["width"])}x${String(d["height"])}${d["primary"] === true ? ", primary" : ""})` : "",
        )
        .join(", ")}.`,
    );
  }
  return lines.join("\n");
}

function pastTense(action: string): string {
  return { maximize: "Maximized", minimize: "Minimized", restore: "Restored", move: "Moved", resize: "Resized" }[action] ?? "Arranged";
}

/** A window as the answers name it: its title and the handle to name it by. */
function windowName(result: Record<string, unknown>): string {
  const title = typeof result["window"] === "string" ? result["window"] : typeof result["title"] === "string" ? result["title"] : "";
  const handle = typeof result["handle"] === "number" && result["handle"] !== 0 ? result["handle"] : undefined;
  if (title === "" && handle === undefined) return "The window";
  if (handle === undefined) return `"${title}"`;
  return title === "" ? `window ${String(handle)}` : `"${title}" (window ${String(handle)})`;
}

/**
 * What `open` did, and which window it landed in. The handle is the point:
 * every later call names the window rather than trusting that it is still
 * the one in front, which is the rule that keeps a model's typing out of the
 * person's own windows (driver.ps1, "The target").
 */
function openSentence(result: Record<string, unknown>): string {
  const named = windowName(result);
  if (result["started"] === true) {
    return typeof result["handle"] === "number" && result["handle"] !== 0
      ? `Started ${String(result["what"])}; its window is ${named}. ${result["focused"] === true ? "It is in front and being worked in." : "Focus was not confirmed; observe status before input."}`
      : `Started ${String(result["what"])}, but no new window appeared within five seconds. List windows to find it, then focus it by handle.`;
  }
  return result["focused"] === true
    ? `Brought ${named} to the front; it is the window being worked in.`
    : `${named} is open but could not be brought to the front; click inside it.`;
}

function displayArg(input: Record<string, unknown>): Record<string, unknown> {
  const display = num(input, "display");
  return display === undefined ? {} : { display };
}

export const TOOLS: readonly ToolDefinition[] = [
  // ─── Seeing ───────────────────────────────────────────────────────────
  {
    name: "studio_computer_displays",
    description:
      "List the displays attached to this computer: index, size and position. " +
      "Every other tool's coordinates are in one display's pixels; the primary display is the default.",
    effect: "read",
    inputSchema: object({}),
    run: async (session) => {
      const displays = await session.request("displays");
      const lines = Array.isArray(displays)
        ? displays.map((d: unknown) =>
            isRecord(d)
              ? `Display ${String(d["index"])}: ${String(d["width"])}x${String(d["height"])} at (${String(d["x"])},${String(d["y"])})${d["primary"] === true ? ", primary" : ""}`
              : "",
          )
        : [];
      return answer(lines.join("\n"));
    },
  },

  {
    name: "studio_computer_screenshot",
    description:
      "See what is on a display right now. The answer says which display and what size frame " +
      "the picture stands for, and its frameId; give coordinates in that frame, with that frameId. Use zoom to read small text. " +
      "Give a window handle to picture just that window, wherever it is.",
    effect: "read",
    inputSchema: object({
      ...DISPLAY,
      window: { type: "number", description: "A handle from windows: picture only that window's rectangle." },
      capture_mode: {
        type: "string",
        enum: ["display", "window"],
        description: "display (default): the pixels on screen, a frame to point from. window: the window's own drawing even where covered, for reading only; needs window.",
      },
      format: {
        type: "string",
        enum: ["jpeg", "png"],
        description: "jpeg (default, smaller) or png (exact, for reading fine detail). A picture too large as a PNG arrives as a JPEG and says so.",
      },
    }),
    run: async (session, input) => {
      const window = num(input, "window");
      const mode = str(input, "capture_mode") ?? "display";
      if (mode !== "display" && mode !== "window") throw new ComputerError("bad_input", { message: "capture_mode must be display or window." });
      if (mode === "window" && window === undefined) throw new ComputerError("bad_input", { message: "Window capture pictures one window: give its handle." });
      const shot = await picture(session, {
        ...displayArg(input),
        ...(window === undefined ? {} : { window }),
        mode,
        max: SCREENSHOT_SIDE_PX,
        format: str(input, "format") ?? "jpeg",
      });
      return { content: [text(shot.line), shot.image], structuredContent: { frame: shot.frame } };
    },
  },

  {
    name: "studio_computer_zoom",
    description:
      "A close-up of one region of a display, at full resolution, for reading small text or " +
      "checking fine detail. Coordinates you give afterwards are still in the display's frame, with the zoom's frameId.",
    effect: "read",
    inputSchema: object(
      {
        region: {
          type: "array",
          items: NUMBER,
          minItems: 4,
          maxItems: 4,
          description: "[left, top, right, bottom] in the display's pixels.",
        },
        ...DISPLAY,
      },
      ["region"],
    ),
    run: async (session, input) => {
      const region = input["region"];
      if (!Array.isArray(region) || region.length !== 4 || !region.every((n) => typeof n === "number")) {
        throw new ComputerError("bad_input", { message: "Give region as [left, top, right, bottom]." });
      }
      const shot = await picture(session, { ...displayArg(input), region, max: SCREENSHOT_SIDE_PX, format: "png" });
      return { content: [text(shot.line), shot.image], structuredContent: { frame: shot.frame } };
    },
  },

  // ─── The pointer ──────────────────────────────────────────────────────
  {
    name: "studio_computer_cursor",
    description: "Where the pointer is now, and on which display.",
    effect: "read",
    inputSchema: object({}),
    run: async (session) => {
      const cursor = await session.request("cursor");
      return answer(
        isRecord(cursor)
          ? `Pointer at (${String(cursor["x"])},${String(cursor["y"])}) on display ${String(cursor["display"])}.`
          : "The pointer position could not be read.",
      );
    },
  },

  {
    name: "studio_computer_move",
    description: "Move the pointer without clicking, for hover states and tooltips.",
    effect: "write",
    inputSchema: object({ ...POINT, ...FRAME, ...DISPLAY }, ["x", "y", "frameId"]),
    run: async (session, input, context) => {
      const where = framedPoint(input, context);
      const sent = await session.request("move", { ...where, x: requiredNumber(input, "x"), y: requiredNumber(input, "y") });
      return acted(session, "Moved.", where["display"], sent);
    },
  },

  {
    name: "studio_computer_click",
    description:
      "Click at a point on a display. One tool for every kind of click: choose the button, " +
      "how many times (2 for a double-click, 3 to select a line), and any keys to hold. " +
      "Prefer act with a complete ui_ reference from the latest read_ui when the control has one; click when it does not. " +
      "Copy the display index and display-relative centre from read_ui, with its frameId. After input, inspect the observation; read controls again when the window changed.",
    effect: "write",
    inputSchema: object(
      {
        ...POINT,
        ...FRAME,
        button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." },
        count: { type: "number", description: "1, 2 or 3. Default 1." },
        ...MODIFIERS,
        ...DISPLAY,
      },
      ["x", "y", "frameId"],
    ),
    run: async (session, input, context) => {
      const count = num(input, "count") ?? 1;
      if (count < 1 || count > 3) {
        throw new ComputerError("bad_input", { message: "count must be 1, 2 or 3." });
      }
      const where = framedPoint(input, context);
      const sent = await session.request("click", {
        ...where,
        x: requiredNumber(input, "x"),
        y: requiredNumber(input, "y"),
        button: str(input, "button") ?? "left",
        count,
        modifiers: str(input, "modifiers") ?? "",
      });
      const what = count === 1 ? "Clicked" : count === 2 ? "Double-clicked" : "Triple-clicked";
      return acted(session, withNote(`${what}.`, sent, "outside"), where["display"], sent);
    },
  },

  {
    name: "studio_computer_drag",
    description:
      "Press at one point, move to another and release: drag and drop, or a selection by mouse. Every point comes from the frame named. " +
      "path adds points to pass through, and settle_ms a pause at each, for targets that react to hovering (a folder that opens, a drop zone that lights up).",
    effect: "write",
    inputSchema: object(
      {
        from: { type: "array", items: NUMBER, minItems: 2, maxItems: 2, description: "[x, y] to start at." },
        to: { type: "array", items: NUMBER, minItems: 2, maxItems: 2, description: "[x, y] to release at." },
        path: { type: "array", items: { type: "array", items: NUMBER, minItems: 2, maxItems: 2 }, maxItems: 10, description: "Up to 10 [x, y] points to pass through on the way, in order." },
        settle_ms: { type: "number", description: "Pause at each path point, in milliseconds. At most 2000; default none." },
        ...FRAME,
        ...DISPLAY,
      },
      ["from", "to", "frameId"],
    ),
    run: async (session, input, context) => {
      const from = input["from"];
      const to = input["to"];
      const isPoint = (v: unknown): v is [number, number] =>
        Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
      if (!isPoint(from) || !isPoint(to)) {
        throw new ComputerError("bad_input", { message: "Give from and to as [x, y]." });
      }
      const path = input["path"] === undefined ? [] : input["path"];
      if (!Array.isArray(path) || path.length > 10 || !path.every(isPoint)) {
        throw new ComputerError("bad_input", { message: "Give path as at most 10 [x, y] points." });
      }
      const where = framedPoint(input, context);
      const sent = await session.request("drag", { ...where, from, to, path, settle: Math.max(0, Math.min(num(input, "settle_ms") ?? 0, 2000)) });
      return acted(session, withNote(path.length === 0 ? "Dragged." : `Dragged through ${String(path.length)} point${path.length === 1 ? "" : "s"}.`, sent, "outside"), where["display"], sent);
    },
  },

  {
    name: "studio_computer_mouse_button",
    description:
      "Press and hold a mouse button, or release it, at the pointer's current position. " +
      "For the rare drag that needs something to happen in between; drag covers the ordinary case. " +
      "A press names the frame the pointer was placed from; a release needs none. Each answers with a picture, so a held drag is never blind.",
    effect: "write",
    inputSchema: object(
      {
        action: { type: "string", enum: ["down", "up"] },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." },
        frameId: { type: "string", description: "For down: the frameId of the picture the pointer was placed from. Not needed for up." },
      },
      ["action"],
    ),
    run: async (session, input, context) => {
      const action = required(input, "action");
      if (action !== "down" && action !== "up") {
        throw new ComputerError("bad_input", { message: "action must be down or up." });
      }
      // Releasing is cleanup and never waits on a frame.
      const where = action === "down" ? framedPoint(input, context) : {};
      const sent = await session.request("button", { action, button: str(input, "button") ?? "left" });
      return acted(session, action === "down" ? "Button held." : "Button released.", where["display"], sent);
    },
  },

  {
    name: "studio_computer_scroll",
    description:
      "Scroll in a direction by some ticks: a control by its ui_ reference (its own scrolling when it has some, else the wheel at its centre), " +
      "or a point, which names the frame it was read from.",
    effect: "write",
    inputSchema: object(
      {
        ref: { type: "string", description: "A reference from read_ui, instead of x, y and frameId." },
        x: { type: "number", description: "With y and frameId, when no ref is given: where to scroll, in the display's pixels." },
        y: { type: "number", description: "With x and frameId." },
        frameId: { type: "string", description: "With x and y: the frameId of the picture or read the point was read from." },
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Ticks. Default 3." },
        ...DISPLAY,
      },
      ["direction"],
    ),
    run: async (session, input, context) => {
      const direction = required(input, "direction");
      const ref = str(input, "ref");
      if (ref !== undefined) {
        const sent = await session.request("scroll", { ref, direction, amount: num(input, "amount") ?? 3 });
        const via = isRecord(sent) && sent["via"] === "pattern" ? "with the control's own scrolling" : "with the wheel at its centre";
        return acted(session, `Scrolled ${direction} ${via}.`, undefined, sent);
      }
      const where = framedPoint(input, context);
      const sent = await session.request("scroll", {
        ...where,
        x: requiredNumber(input, "x"),
        y: requiredNumber(input, "y"),
        direction,
        amount: num(input, "amount") ?? 3,
      });
      return acted(session, `Scrolled ${direction}.`, where["display"], sent);
    },
  },

  // ─── The keyboard ─────────────────────────────────────────────────────
  {
    name: "studio_computer_type",
    description:
      "Type text into the window being worked in, at its keyboard focus. Newlines press Return. " +
      "Refused if another window has come to the front since it was opened, focused, read or clicked in. " +
      "For a shortcut use key; for a field that has a ui_ reference, set_value is exact.",
    effect: "write",
    inputSchema: object({ text: STRING }, ["text"]),
    run: async (session, input, context) => {
      const body = input["text"];
      if (typeof body !== "string") throw new ComputerError("bad_input", { message: "Give the text to type." });
      const sent = await session.request("type", { text: body, allowPassword: context?.allowPassword === true });
      return acted(session, withFront(`Typed ${String(body.length)} characters.`, sent), undefined, sent);
    },
  },

  {
    name: "studio_computer_key",
    description:
      'Press a key or a shortcut: "return", "escape", "tab", "ctrl+s", "alt+f4", "win+d", "ctrl+shift+t". ' +
      "Names: letters, digits, return, tab, escape, backspace, delete, space, home, end, pageup, pagedown, " +
      "up, down, left, right, f1-f12, ctrl, shift, alt, win. Goes to the window being worked in, " +
      "and is refused if another window has come to the front.",
    effect: "write",
    inputSchema: object(
      {
        keys: { type: "string", description: 'The key or chord, joined with "+".' },
        repeat: { type: "number", description: "How many times. Default 1." },
      },
      ["keys"],
    ),
    run: async (session, input) => {
      const keys = required(input, "keys");
      const repeat = num(input, "repeat") ?? 1;
      const sent = await session.request("key", { keys, repeat });
      return acted(session, withFront(repeat === 1 ? `Pressed ${keys}.` : `Pressed ${keys} ${String(repeat)} times.`, sent), undefined, sent);
    },
  },

  {
    name: "studio_computer_hold_key",
    description:
      "Hold a key or chord for some seconds, then release it: for a game or a long-press. " +
      "Or press it down in one call and let it go in a later one (action down, then up), to hold a modifier across clicks - shift-click a range, ctrl-click several. " +
      "Anything still held is let go if a call fails, or the desktop is paused, handed over or stopped. Answers with a picture.",
    effect: "write",
    inputSchema: object(
      {
        keys: { type: "string", description: 'The key or chord, joined with "+".' },
        seconds: { type: "number", description: "How long to hold, then release. At most 30. Not with action." },
        action: { type: "string", enum: ["down", "up"], description: "down: press and keep holding. up: let go of what down pressed." },
      },
      ["keys"],
    ),
    run: async (session, input) => {
      const keys = required(input, "keys");
      const action = str(input, "action");
      if (action !== undefined) {
        if (action !== "down" && action !== "up") throw new ComputerError("bad_input", { message: "action must be down or up." });
        const sent = await session.request("key_toggle", { keys, action });
        const held = isRecord(sent) && typeof sent["held"] === "number" ? sent["held"] : 0;
        return acted(session, withFront(action === "down" ? `Holding ${keys} until hold_key action up.` : `Let go of ${keys}; ${held === 0 ? "nothing is held now" : `${String(held)} key${held === 1 ? " is" : "s are"} still held`}.`, sent), undefined, sent);
      }
      const seconds = Math.min(requiredNumber(input, "seconds"), 30);
      const sent = await session.request("hold", { keys, seconds });
      return acted(session, withFront(`Held ${keys} for ${String(seconds)} seconds.`, sent), undefined, sent);
    },
  },

  // ─── Windows and apps ─────────────────────────────────────────────────
  {
    name: "studio_computer_apps",
    description: "The applications with a window open right now, and which one is in front.",
    effect: "read",
    inputSchema: object({}),
    run: async (session) => {
      const apps = await session.request("apps");
      const lines = Array.isArray(apps)
        ? apps.map((a: unknown) =>
            isRecord(a)
              ? `${String(a["app"])} - ${String(a["windows"])} ${a["windows"] === 1 ? "window" : "windows"}${a["foreground"] === true ? ", in front" : ""}`
              : "",
          )
        : [];
      return answer(lines.length === 0 ? "No application has a window open." : lines.join("\n"));
    },
  },

  {
    name: "studio_computer_windows",
    description:
      "The windows on screen, with a handle to name one by, its title, app, display, position and size. " +
      "Says which is in front and which is the one being worked in. Give an app name to see only its windows.",
    effect: "read",
    inputSchema: object({ app: { type: "string", description: "Filter by app or title, case-insensitively." } }),
    run: async (session, input) => {
      const windows = await session.request("windows", { app: str(input, "app") ?? "" });
      // The one in front first, then the largest: a person's "the Studio
      // window" is the big one, not the 16-pixel helper the same process
      // also owns, and a model that takes the first match should get it.
      const area = (w: unknown): number =>
        isRecord(w) && typeof w["width"] === "number" && typeof w["height"] === "number" ? w["width"] * w["height"] : 0;
      const ordered: unknown[] = Array.isArray(windows)
        ? (windows as unknown[]).slice().sort((a: unknown, b: unknown) => {
            const fa = isRecord(a) && a["foreground"] === true ? 1 : 0;
            const fb = isRecord(b) && b["foreground"] === true ? 1 : 0;
            return fb - fa || area(b) - area(a);
          })
        : [];
      const lines = Array.isArray(ordered)
        ? ordered.map((w: unknown) =>
            isRecord(w)
              ? `window ${String(w["handle"])}: "${String(w["title"])}" (${String(w["app"])}, process ${String(w["pid"])}${typeof w["processStarted"] === "string" && w["processStarted"] !== "" ? ` started ${w["processStarted"]}` : ""}) on display ${String(w["display"])} at (${String(w["x"])},${String(w["y"])}) ${String(w["width"])}x${String(w["height"])}${w["minimized"] === true ? ", minimized" : ""}${w["foreground"] === true ? ", in front" : ""}${w["target"] === true ? ", the window being worked in" : ""}`
              : "",
          )
        : [];
      return answer(lines.length === 0 ? "No window matches." : lines.join("\n"));
    },
  },

  {
    name: "studio_computer_open",
    description:
      "Open an application by its Start-menu name, or a file or program by path. " +
      "An app with exactly one matching window is brought to the front instead of started twice. " +
      "Multiple matches are refused; list windows and focus the intended handle.",
    effect: "execute",
    inputSchema: object({
      app: { type: "string", description: 'A name as it appears in the Start menu: "Notepad", "Microsoft Edge".' },
      path: { type: "string", description: "A full path to a program or a file to open." },
    }),
    run: async (session, input) => {
      const app = str(input, "app");
      const path = str(input, "path");
      if (app === undefined && path === undefined) {
        throw new ComputerError("bad_input", { message: "Give an app name or a path." });
      }
      const result = await session.request("open", { app: app ?? "", path: path ?? "" });
      const said = isRecord(result) ? openSentence(result) : "Opened.";
      return acted(session, said, undefined, result);
    },
  },

  {
    name: "studio_computer_get_window",
    description:
      "Find a window again by what it was listed as: its handle with the pid and processStarted windows gave. " +
      "Answers the window when the handle still belongs to that process; when Windows has reused the handle, or the window closed, " +
      "lists that process's windows now (or the app's, by name) to choose from. Never picks one for you.",
    effect: "read",
    inputSchema: object({
      window: { type: "number", description: "The handle from windows." },
      pid: { type: "number", description: "The process id windows listed for it." },
      processStarted: { type: "string", description: "The process start windows listed for it." },
      app: { type: "string", description: "The app name, to look by when the process has gone." },
    }),
    run: async (session, input) => {
      const window = num(input, "window");
      const pid = num(input, "pid");
      const app = str(input, "app");
      if (window === undefined && pid === undefined && app === undefined) {
        throw new ComputerError("bad_input", { message: "Give the handle with its pid and processStarted, or an app name." });
      }
      const result = await session.request("get_window", { window: window ?? "", pid: pid ?? "", processStarted: str(input, "processStarted") ?? "", app: app ?? "" });
      if (!isRecord(result)) return answer("The desktop could not be asked.");
      if (result["same"] === true && isRecord(result["window"])) {
        return { content: [text(`Window ${String(result["window"]["handle"])} is still the same window: ${windowLine(result["window"])}.`)], structuredContent: { window: result["window"] } };
      }
      const found: unknown[] = Array.isArray(result["windows"]) ? result["windows"] : [];
      const head = result["reused"] === true
        ? `Window ${String(window)} now belongs to another process; Windows reused the handle. Do not act on it.`
        : window === undefined ? "" : `Window ${String(window)} has closed.`;
      const list = found.filter(isRecord).map((w) => `window ${String(w["handle"])}: ${windowLine(w)}`);
      return {
        content: [text([head, list.length === 0 ? "No window of that process or app is open now." : `Open now:\n${list.join("\n")}`].filter((line) => line !== "").join("\n"))],
        structuredContent: { windows: found },
      };
    },
  },

  {
    name: "studio_computer_focus",
    description:
      "Bring a window to the front by its handle from `windows`, restoring it if minimized. " +
      "Give the pid and processStarted it was listed with, and a handle Windows has reused for another window is refused.",
    effect: "write",
    inputSchema: object({
      window: { type: "number", description: "The handle from windows." },
        pid: { type: "number", description: "The process id windows listed for it. With processStarted, refuses a handle Windows has since given to another window." },
        processStarted: { type: "string", description: "The process start windows listed for it." },
    }, ["window"]),
    run: async (session, input) => {
      const result = await session.request("focus", { window: requiredNumber(input, "window"), ...identityArgs(input) });
      const focused = isRecord(result) && result["focused"] === true;
      const named = isRecord(result) ? windowName(result) : "The window";
      return acted(
        session,
        focused
          ? `${named} is in front and is the window being worked in.`
          : `Windows did not bring ${named} to the front; click inside it, or arrange it (restore, maximize) and try again.`,
        undefined,
        result,
      );
    },
  },

  {
    name: "studio_computer_status",
    description:
      "Where the work is: the window being worked in (handle, title, app, display, size, minimized or " +
      "maximized), whether it is the one in front, what is in front if not, whether Windows will let a window be brought to the front, the pointer and the displays. " +
      "The call to make when lost, or before keys, and cheap enough to make often. " +
      "screenshot: true also pictures a display in the same driver request, with a frameId for coordinates.",
    effect: "read",
    inputSchema: object({
      screenshot: { type: "boolean", description: "Also picture a display (the working window's by default), in one request." },
      ...DISPLAY,
    }),
    run: async (session, input) => {
      if (input["screenshot"] !== true) {
        const status = await session.request("status");
        return isRecord(status) ? answer(statusLines(status)) : answer("The desktop could not be asked.");
      }
      const changes = captureChanges();
      const seen = await session.request("observe", {
        status: true,
        picture: { ...displayArg(input), max: SCREENSHOT_SIDE_PX, format: "jpeg", budget: SCREENSHOT_MAX_BYTES },
      });
      const observed = isRecord(seen) ? seen : {};
      const status = observed["status"];
      const words = isRecord(status) ? statusLines(status) : "The desktop could not be asked.";
      const id = typeof observed["observationId"] === "string" && observed["observationId"] !== "" ? observed["observationId"] : createStudioUuid();
      if (!isRecord(observed["picture"])) return answer(`${words}\nThe display could not be pictured; take a screenshot if you need to see it.`);
      const shot = framed(session, observed["picture"], id, changes);
      return { content: [text(`${words}\n${shot.line}`), shot.image], structuredContent: { frame: shot.frame } };
    },
  },

  {
    name: "studio_computer_arrange",
    description:
      "Arrange a window by its handle: maximize (optionally on a given display), minimize, restore, move, " +
      "resize or close. Maximizing the window being worked in on one display is the surest way to keep " +
      "track of it: nothing overlaps it and every picture of that display shows it whole. Close is the " +
      "title bar's X, so an app may ask about unsaved work.",
    effect: "write",
    inputSchema: object(
      {
        window: { type: "number", description: "The handle from windows, open or status." },
        pid: { type: "number", description: "The process id windows listed for it. With processStarted, refuses a handle Windows has since given to another window." },
        processStarted: { type: "string", description: "The process start windows listed for it." },
        action: { type: "string", enum: ["maximize", "minimize", "restore", "move", "resize", "close"] },
        display: { type: "number", description: "For maximize and move: which display, by index." },
        x: { type: "number", description: "For move: the new left edge, in the display's pixels." },
        y: { type: "number", description: "For move: the new top edge, in the display's pixels." },
        width: { type: "number", description: "For resize: the new width in pixels." },
        height: { type: "number", description: "For resize: the new height in pixels." },
      },
      ["window", "action"],
    ),
    run: async (session, input) => {
      const window = requiredNumber(input, "window");
      const action = required(input, "action");
      const result = await session.request("arrange", {
        window,
        action,
        ...identityArgs(input),
        display: num(input, "display") ?? "",
        x: num(input, "x") ?? "",
        y: num(input, "y") ?? "",
        width: num(input, "width") ?? "",
        height: num(input, "height") ?? "",
      });
      if (action === "close") {
        const closed = isRecord(result) && result["closed"] === true;
        return acted(
          session,
          closed
            ? `Window ${String(window)} has closed.`
            : `Window ${String(window)} was asked to close and is still open; it may be asking about unsaved work.`,
          undefined,
          result,
        );
      }
      const said = isRecord(result) ? `${pastTense(action)} ${windowLine(result)}.` : `${pastTense(action)} window ${String(window)}.`;
      return acted(session, said, isRecord(result) && typeof result["display"] === "number" ? result["display"] : undefined, result);
    },
  },

  {
    name: "studio_computer_wait_for_window",
    description:
      "Wait for a window whose title or app contains some text to appear - a dialog a click raises, a " +
      "file that takes a moment to open - and get its handle. Better than a fixed wait and a guess. " +
      "A dialog the window being worked in raised, now in front, becomes the window being worked in, so the next keys " +
      "in a batch reach it without a focus step; when it closes, the work returns to the window that raised it.",
    effect: "read",
    inputSchema: object(
      {
        text: { type: "string", description: 'Part of the title or app name: "Save As", "Notepad".' },
        seconds: { type: "number", description: "How long to wait at most. Default 10, at most 60." },
        match: {
          type: "string",
          enum: ["title", "app", "automationid", "class"],
          description: "What text is matched against. Default: part of the title or the app. automationid and class match the window's own identifiers exactly, which stay put when a title changes with the document.",
        },
      },
      ["text"],
    ),
    run: async (session, input) => {
      const text = required(input, "text");
      const match = str(input, "match");
      if (match !== undefined && !["title", "app", "automationid", "class"].includes(match)) {
        throw new ComputerError("bad_input", { message: "match must be title, app, automationid or class." });
      }
      const result = await session.request("wait_window", { text, seconds: num(input, "seconds") ?? "", match: match ?? "" });
      if (!isRecord(result) || result["found"] !== true) {
        return answer(`No window matching "${text}" appeared within ${String(isRecord(result) ? result["waited"] : "")} seconds.`);
      }
      const front = result["adopted"] === true
        ? " It is in front and was raised by the window being worked in, so it is now the one being worked in; keys go to it, and once it closes the work returns to the window that raised it."
        : result["foreground"] === true ? " It is in front; focus it by handle before keys." : " It is not in front; focus it before keys.";
      return answer(`${windowName(result)} (${String(result["app"])}) is on display ${String(result["display"])}.${front}`);
    },
  },

  // ─── Reading and driving controls ─────────────────────────────────────
  {
    name: "studio_computer_read_ui",
    description:
      "Read a window's controls as an outline, each stamped with a complete ui_<observation-id>_<index> reference, display index and display-relative centre point. " +
      "The reliable way to find what to act on: use act, set_value or select_text with a reference, " +
      "or click its centre. Reads the window named by handle, or else the one last opened, focused, " +
      "read or clicked in; it never reads whatever happens to be in front. References stay valid across Studio's input while their controls are on screen, and expire on a new read, the person's own input, or driver restart; a stale one is refused. " +
      "Work one observed step at a time: choose the intended window, read it, act once, and inspect the returned observation and screenshot. " +
      "If a window closes or changes, use status/windows (or wait_for_window for a delayed transition), choose and focus the intended replacement explicitly, then read_ui again. " +
      "Never infer authority from foreground alone. A dispatched action is not a verified result; reobserve instead of replaying uncertain input. " +
      "Tool results report non-injected mouse/key activity observed since the last result, with current pointer and window state. " +
      "These updates do not stop computer use automatically. Reconcile them with your task and read fresh controls before continuing; key contents are never included. " +
      "Reading needs the desktop like input does: whoever else holds it, another task or conversation or the person showing something, refuses the read until it is released. " +
      "The read has a frameId: give it with a centre you click. screenshot: true pictures the window in the same request, under the same frameId. " +
      "A password field's value is never read; it shows as [password].",
    effect: "read",
    inputSchema: object({
      window: { type: "number", description: "A handle from windows or open. Defaults to the window being worked in." },
      all: { type: "boolean", description: "Include text and structure, not only controls." },
      query: { type: "string", description: "List only controls whose name or kind contains this text, case-insensitively." },
      depth: { type: "number", description: "How deep to walk. Default 12." },
      limit: { type: "number", description: `Most controls to list. Default 400, at most ${String(READ_UI_MAX_LIMIT)}.` },
      screenshot: { type: "boolean", description: "Also picture the window, in the same request and under the same frameId." },
    }),
    run: async (session, input) => {
      const limit = num(input, "limit");
      const read = {
        window: num(input, "window") ?? "",
        all: input["all"] === true,
        query: str(input, "query") ?? "",
        depth: num(input, "depth") ?? "",
        limit: limit === undefined ? "" : Math.min(Math.max(1, limit), READ_UI_MAX_LIMIT),
      };
      const changes = captureChanges();
      const withPicture = input["screenshot"] === true;
      const seen = withPicture
        ? await session.request("observe", { ui: read, picture: { max: SCREENSHOT_SIDE_PX, format: "jpeg", budget: SCREENSHOT_MAX_BYTES } })
        : await session.request("read_ui", read);
      const result = withPicture ? (isRecord(seen) ? seen["ui"] : undefined) : seen;
      if (!isRecord(result)) return answer("The window could not be read.");
      const elements = elementsFrom(result["elements"]);
      const displays = [...new Set(elements.map((element) => element["display"]).filter((d): d is number => typeof d === "number"))];
      const id = typeof result["observationId"] === "string" && result["observationId"] !== "" ? result["observationId"] : undefined;
      const minimized = result["minimized"] === true ? " This window is minimized; focus it before acting on it." : "";
      const outline = typeof result["outline"] === "string" ? result["outline"] : "";
      const words = `Window: ${windowName(result)}${minimized}${id === undefined ? "" : `\nframeId: ${id}`}\n\n${outline === "" ? "No controls were found. Try all: true, or a screenshot." : outline}`;
      const ui = {
        window: typeof result["window"] === "string" ? result["window"] : "",
        handle: typeof result["handle"] === "number" ? result["handle"] : null,
        frameId: id ?? null,
        minimized: result["minimized"] === true,
        truncated: result["truncated"] === true,
        depthLimited: result["depthLimited"] === true,
        elements,
      };
      const picturePart = withPicture && isRecord(seen) ? seen["picture"] : undefined;
      if (id !== undefined && isRecord(picturePart)) {
        const shot = framed(session, picturePart, id, changes, displays);
        return { content: [text(`${words}\n\n${shot.line}`), shot.image], structuredContent: { ui, frame: shot.frame } };
      }
      if (id !== undefined && changes !== undefined) session.offerFrame({ id, displays, changes });
      const unpictured = withPicture ? "\n\nThe window could not be pictured; take a screenshot if you need to see it." : "";
      return { content: [text(`${words}${unpictured}`)], structuredContent: { ui } };
    },
  },

  {
    name: "studio_computer_act",
    description:
      "Do what a control does, by reference: invoke a button or menu item, toggle a checkbox, " +
      "expand or collapse, select an item, focus a field, scroll it into view, scroll it or set its scroll position, " +
      "set or step a slider's value, or move, resize or rotate it. Works without moving the pointer, which is what makes it reliable. " +
      "The read lists each control's patterns; an action it does not support is refused with the ones it does.",
    effect: "write",
    inputSchema: object(
      {
        ref: { type: "string", description: "The complete reference from the latest read_ui. A stale one is refused; read again then." },
        action: {
          type: "string",
          description: "Default invoke. One of: invoke, toggle, expand, collapse, select, focus, scroll_into_view, scroll (direction, amount), " +
            "scroll_to (x and y as percentages), set_range (value), increase, decrease, move (x, y, display), resize (width, height), rotate (value in degrees).",
        },
        direction: { type: "string", enum: ["up", "down", "left", "right"], description: "For scroll." },
        amount: { type: "number", description: "For scroll: steps. Default 3." },
        value: { type: "number", description: "For set_range, and degrees for rotate." },
        x: { type: "number", description: "For move: display pixels. For scroll_to: horizontal percent." },
        y: { type: "number", description: "For move: display pixels. For scroll_to: vertical percent." },
        width: { type: "number", description: "For resize." },
        height: { type: "number", description: "For resize." },
        ...DISPLAY,
      },
      ["ref"],
    ),
    run: async (session, input) => {
      const result = await session.request("act", {
        ref: required(input, "ref"),
        action: str(input, "action") ?? "invoke",
        direction: str(input, "direction") ?? "",
        amount: num(input, "amount") ?? "",
        value: num(input, "value") ?? "",
        x: num(input, "x") ?? "",
        y: num(input, "y") ?? "",
        width: num(input, "width") ?? "",
        height: num(input, "height") ?? "",
        display: num(input, "display") ?? "",
      });
      return acted(session, isRecord(result) ? String(result["said"]) : "Done.", undefined, result);
    },
  },

  {
    name: "studio_computer_set_value",
    description:
      "Set a field's value directly, by reference. Exact and instant, where the field allows it. " +
      "Studio asks the person before filling a password field.",
    effect: "write",
    inputSchema: object(
      {
        ref: { type: "string", description: "A reference from read_ui." },
        value: STRING,
      },
      ["ref", "value"],
    ),
    run: async (session, input, context) => {
      const value = input["value"];
      if (typeof value !== "string") throw new ComputerError("bad_input", { message: "Give the value as text." });
      const result = await session.request("set_value", { ref: required(input, "ref"), value, allowPassword: context?.allowPassword === true });
      return acted(session, isRecord(result) ? String(result["said"]) : "Set.", undefined, result);
    },
  },

  {
    name: "studio_computer_select_text",
    description: "Select a range of characters in a text control, by reference, so it can be copied or replaced. Answers with a picture of the selection.",
    effect: "write",
    inputSchema: object(
      {
        ref: { type: "string", description: "A reference from read_ui." },
        start: { type: "number", description: "Character offset to start at." },
        end: { type: "number", description: "Character offset to end at." },
      },
      ["ref", "start", "end"],
    ),
    run: async (session, input) => {
      const result = await session.request("select_text", {
        ref: required(input, "ref"),
        start: requiredNumber(input, "start"),
        end: requiredNumber(input, "end"),
      });
      return acted(session, isRecord(result) ? String(result["said"]) : "Selected.", undefined, result);
    },
  },

  // ─── The rest ─────────────────────────────────────────────────────────
  {
    name: "studio_computer_clipboard",
    description:
      "Read what is on the clipboard as text, put text on it, or paste text or HTML into the window being worked in. " +
      "A write says what kind of thing it replaced (never its content). A paste puts back clipboard text afterwards, and says when what was there could not be put back. " +
      "Studio asks the person before a read.",
    // Either direction moves data between applications the person uses.
    effect: "execute",
    inputSchema: object(
      {
        action: { type: "string", enum: ["read", "write", "paste"] },
        text: { type: "string", description: "For write and paste: the text, or for format html the markup." },
        format: { type: "string", enum: ["text", "html"], description: "For paste: text (default) or html, which arrives formatted where the app takes HTML." },
      },
      ["action"],
    ),
    run: async (session, input, context) => {
      const action = required(input, "action");
      if (action === "read") {
        const result = await session.request("clipboard", { action: "read" });
        const body = isRecord(result) && typeof result["text"] === "string" ? result["text"] : "";
        return answer(body === "" ? "The clipboard has no text." : `Clipboard:\n${body.slice(0, 20_000)}`);
      }
      if (action === "write") {
        const body = input["text"];
        if (typeof body !== "string") throw new ComputerError("bad_input", { message: "Give the text to write." });
        const result = await session.request("clipboard", { action: "write", text: body });
        const replaced = isRecord(result) ? result["replaced"] : undefined;
        const over = replaced === "text" ? ` It replaced ${String(isRecord(result) ? result["replacedLength"] : 0)} characters of text, which are gone.`
          : replaced === "image" ? " It replaced an image, which is gone."
          : replaced === "files" ? " It replaced a list of copied files, which is gone." : "";
        return answer(`Wrote ${String(body.length)} characters to the clipboard.${over}`);
      }
      if (action === "paste") {
        const body = input["text"];
        if (typeof body !== "string") throw new ComputerError("bad_input", { message: "Give the text to paste." });
        const format = str(input, "format") ?? "text";
        if (format !== "text" && format !== "html") throw new ComputerError("bad_input", { message: "format must be text or html." });
        const sent = await session.request("paste", { text: body, format, allowPassword: context?.allowPassword === true });
        const restored = isRecord(sent) && sent["restored"] === true;
        const previous = isRecord(sent) ? String(sent["previous"]) : "unknown";
        return acted(session, withFront(`Pasted ${String(body.length)} characters as ${format}. ${restored ? "The clipboard holds what it held before." : `The clipboard held ${previous === "image" ? "an image" : previous === "files" ? "copied files" : "something"} that could not be put back; it now holds the pasted content.`}`, sent), undefined, sent);
      }
      throw new ComputerError("bad_input", { message: "action must be read, write or paste." });
    },
  },

  {
    name: "studio_computer_wait",
    description: "Wait some seconds for the screen to catch up. Use sparingly; most changes are quick.",
    effect: "read",
    inputSchema: object({ seconds: { type: "number", description: "At most 30." } }, ["seconds"]),
    run: async (session, input) => {
      const seconds = Math.min(Math.max(requiredNumber(input, "seconds"), 0), 30);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return acted(session, `Waited ${String(seconds)} seconds.`, undefined);
    },
  },

  {
    name: "studio_computer_batch",
    description:
      "Run several steps in one call, in order: click, type, key, act, set_value, scroll, wait_for_window and the rest. " +
      "Stops at the first step that fails and lists the ones not run; never repeat those automatically. " +
      "Answers with each step's receipt and one picture at the end. Use it whenever you already know the next steps " +
      "(fill a form, walk a menu, type then press return): it saves a model turn per step. " +
      "Coordinate steps use the batch's frameId unless they name their own; every frame is checked before any step runs.",
    effect: "write",
    inputSchema: object(
      {
        steps: {
          type: "array",
          description: `At most ${String(BATCH_MAX_STEPS)}. Each is { "tool": "click", ...that tool's arguments }, the tool named without its studio_computer_ prefix.`,
          items: {
            type: "object",
            properties: { tool: { type: "string", enum: [...BATCH_STEPS] } },
            required: ["tool"],
          },
        },
        frameId: { type: "string", description: "The frame the steps' coordinates were read from, for every coordinate step that names none." },
        display: { type: "number", description: "Which display the final picture shows. Default: the window being worked in." },
      },
      ["steps"],
    ),
    run: async (session, input, context) => {
      const steps = input["steps"];
      if (!Array.isArray(steps) || steps.length === 0) throw new ComputerError("bad_input", { message: "Give the steps as a list." });
      if (steps.length > BATCH_MAX_STEPS) throw new ComputerError("bad_input", { message: `A batch runs at most ${String(BATCH_MAX_STEPS)} steps.` });
      // Every step is checked before any input goes out.
      const plan = steps.map((step: unknown, index) => {
        const name = isRecord(step) ? step["tool"] : undefined;
        const tool = typeof name === "string" && BATCH_STEPS.has(name) ? toolByName(`studio_computer_${name}`) : undefined;
        if (tool === undefined || !isRecord(step)) {
          throw new ComputerError("bad_input", { message: `Step ${String(index + 1)} names no tool a batch runs. Use one of: ${[...BATCH_STEPS].join(", ")}.` });
        }
        const { tool: _named, ...args } = step;
        return { name: name as string, tool, args: withBatchFrame(name as string, args, input["frameId"]) };
      });
      // The steps' own deadlines, summed before anything is sent: a batch
      // that could outlast its call would be cut off with its outcome unknown.
      const budget = plan.reduce((sum, step) => sum + stepBudget(step.name, step.args), 0);
      if (budget > BATCH_MAX_MS) {
        throw new ComputerError("bad_input", { message: `These steps could take up to ${String(Math.ceil(budget / 1000))} seconds, more than one batch may (${String(BATCH_MAX_MS / 1000)}). Nothing was sent. Split them into shorter batches.` });
      }
      const lines: string[] = [];
      let failed = false;
      batching.add(session);
      try {
        for (const [index, step] of plan.entries()) {
          try {
            // Checked step by step, since a step's target is only known once
            // the steps before it ran. A step that needs the person stops the
            // batch here, before anything of it is sent.
            const gated = await context?.gate?.(step.name, step.args);
            if (gated?.refusal !== undefined) throw new ComputerError("refused", { message: gated.refusal });
            const stepContext = context === undefined ? undefined : { ...context, allowPassword: gated?.allowPassword === true };
            lines.push(`${String(index + 1)}. ${step.name}: ${stepLines(await step.tool.run(session, step.args, stepContext))}`);
          } catch (error) {
            failed = true;
            lines.push(`${String(index + 1)}. ${step.name} failed: ${errorText(error)}`);
            const rest = plan.slice(index + 1).map((later, offset) => `${String(index + 2 + offset)}. ${later.name}`);
            if (rest.length > 0) lines.push(`Not run: ${rest.join(", ")}. Observe before deciding; do not replay them automatically.`);
            break;
          }
        }
      } finally {
        batching.delete(session);
      }
      lines.push("Input was dispatched; the intended application result is not verified. Look at the picture before going on.");
      const final = await acted(session, lines.join("\n"), num(input, "display"));
      return failed ? { ...final, isError: true } : final;
    },
  },

  {
    name: "studio_computer_mark",
    description:
      "Point at things on the person's screen while you talk: a point (\"this one\"), a ring around something, a box around an area, " +
      "or an arrow from x,y to toX,toY, each with an optional short label. Up to 6 at once on one display, in the display's pixels like a click; " +
      "they fade after seconds (default 6, at most 30). clear: true takes yours down early. A mark sends no input and needs no desktop. " +
      "Studio draws them above every window, so they show in screenshots taken while they are up. Point from a fresh picture, never a stale one.",
    // No input, but it changes what the person's screen shows.
    effect: "write",
    inputSchema: object({
      ...DISPLAY,
      marks: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["point", "ring", "box", "arrow"] },
            x: NUMBER, y: NUMBER,
            width: { type: "number", description: "ring and box: the area's width from x." },
            height: { type: "number", description: "ring and box: the area's height from y." },
            toX: { type: "number", description: "arrow: where it points." },
            toY: { type: "number", description: "arrow: where it points." },
            label: { type: "string", description: "A few words beside the mark." },
          },
          required: ["kind", "x", "y"],
          additionalProperties: false,
        },
      },
      seconds: { type: "number", description: "How long they show. Default 6, at most 30." },
      clear: { type: "boolean", description: "Take down the marks you showed instead." },
    }),
    run: async (session, input) => {
      if (input["clear"] === true) {
        return { content: [text("Your marks were taken down.")], structuredContent: { marks: { clear: true } } };
      }
      const set = markSet(input, displaysFrom(await session.request("displays")), Date.now());
      const seconds = Math.round((set.expiresAt - Date.now()) / 1_000);
      return {
        content: [text(`Showing ${String(set.marks.length)} mark${set.marks.length === 1 ? "" : "s"} on display ${String(set.display.index)} for ${String(seconds)} seconds. ` +
          "The person sees them now, and pictures taken while they are up include them. Marks point; they do not click.")],
        structuredContent: { marks: set },
      };
    },
  },

  {
    name: "studio_computer_control",
    description:
      "Who has the desktop, and taking or giving it back. One actor at a time may send input: this conversation's own agent, " +
      "one of its tasks, or another conversation. Looking (screenshot, status, zoom, cursor, windows) is open to every actor; input is the owner's. " +
      "status: the mode (active, paused, demonstrating, stopping), the owner, and whether you have looked since the screen last may have changed. " +
      "acquire: take a free desktop without sending anything; after a pause it hands a paused task's desktop to the agent the person is talking to. " +
      "release: give the desktop back when your desktop work is done, letting go of anything Studio holds. " +
      "wait: while paused or while the person shows something, wait up to 20 seconds for that to change, then read status again. " +
      "latest: the newest picture anyone in this conversation took (a task's included), with who took it, when, the pointer sampled with it, " +
      "and whether it may be stale. It is evidence from then, not the screen now: it never counts as your look before input. " +
      "Holding the desktop is not permission: each action is still approved on its own. A refusal means no input was sent; " +
      "never route the same input through another tool or a delegate to get around it.",
    effect: "write",
    inputSchema: object({ action: { type: "string", enum: ["status", "acquire", "release", "wait", "latest"] } }, ["action"]),
    run: async (session, input, context) => {
      if (context === undefined) throw new ComputerError("internal", { message: "Desktop control was called without its lease." });
      const { actor, desktop } = context;
      const action = required(input, "action");
      if (action === "latest") {
        const latest = session.latestObservation;
        const state = desktop.state(actor);
        if (latest === undefined) return controlAnswer(state, "No picture has been taken in this conversation yet; take a screenshot.");
        const now = Date.now();
        const { data, ...meta } = latest;
        return {
          content: [text(describeObservation(latest, desktop.changes, now)), { type: "image", data, mimeType: latest.image.mimeType }],
          structuredContent: { desktop: state, observation: { ...meta, stale: staleReasons(latest, desktop.changes, now) } },
        };
      }
      if (action === "wait") await desktop.waitForChange(20_000, context.signal);
      else if (action === "acquire") {
        // A paused owner of this conversation hands over only to the agent the person talks to.
        const taken = actor.role === "worker" ? "not_paused" : desktop.takeOver(session, actor);
        const result = taken === "acquired" ? "acquired" : desktop.acquire(session, actor);
        if (result !== "acquired" && result !== "already") {
          const state = { ...desktop.state(actor), refused: result };
          return { isError: true, content: [text(refusalMessage(state))], structuredContent: { desktop: state } };
        }
      } else if (action === "release") {
        if (desktop.release(actor) && session.running) {
          // Let go of a button or key Studio still holds; failing to is said, not hidden.
          try { await session.request("release_held"); }
          catch { return controlAnswer(desktop.state(actor), "Released the desktop, but releasing held input was not confirmed. Look at the screen before assuming nothing is still pressed."); }
        }
      } else if (action !== "status") throw new ComputerError("bad_input", { message: "action must be status, acquire, release, wait or latest." });
      return controlAnswer(desktop.state(actor));
    },
  },

  {
    name: "studio_computer_stop",
    description:
      "Stop new computer input for this conversation. Let the active call finish within its deadline, then release held input and close the driver. " +
      "Rarely needed - an idle driver closes itself, and the next tool call starts another.",
    effect: "write",
    inputSchema: object({}),
    run: async (session) => {
      const was = session.running;
      // Closing stdin fences queued actions immediately. The driver's finally
      // releases all Studio-held buttons/modifiers after the active call ends.
      const clean = await session.close();
      if (!clean) return { isError: true, content: [{ type: "text", text: "Computer stop was requested, but orderly driver exit and held-input cleanup were not confirmed. Check the desktop before continuing; do not repeat an uncertain action." }] };
      return answer(was ? "Computer control has stopped." : "Computer control was not running.");
    },
  },
];

/** The lease as words and as structure, so a caller never infers ownership from prose. */
export function describeDesktop(state: DesktopState): string {
  const owner = state.owner === null ? "Nobody has the desktop."
    : state.owner.self ? "You have the desktop."
    : !state.owner.sameConversation ? "Another conversation has the desktop."
    : state.owner.role === "worker" ? `${state.owner.name ?? "A task"}${state.owner.taskId === undefined ? "" : ` (task ${state.owner.taskId})`} has the desktop.`
    : "This conversation's own agent has the desktop.";
  const mode = {
    active: "",
    paused: " Computer work is paused by the person.",
    demonstrating: " The person is showing something; automation is held back.",
    stopping: " Computer control is stopping; cleanup is not yet confirmed.",
  }[state.mode];
  const look = state.fresh ? " Your last look is current." : " Look at the screen before any input: it may have changed since your last look.";
  return `${owner}${mode}${look}`;
}

function controlAnswer(state: DesktopState, note?: string): ToolAnswer {
  return { content: [text(note === undefined ? describeDesktop(state) : `${describeDesktop(state)} ${note}`)], structuredContent: { desktop: state } };
}

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/**
 * The definitions `tools/list` answers. Each carries its effect twice: as
 * the MCP annotations any client reads, and as Studio's own word under
 * `_meta`. Hints, not grants: a client that trusts them is trusting this
 * server's word about itself.
 */
export function definitions(): readonly Record<string, unknown>[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.effect === "read",
      destructiveHint: tool.effect !== "read",
      idempotentHint: tool.effect === "read",
      openWorldHint: true,
    },
    _meta: { "studio/effect": tool.effect },
  }));
}
