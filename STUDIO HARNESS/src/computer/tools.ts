import { ComputerError } from "./errors.js";
import type { ComputerSession } from "./session.js";

/**
 * The tools, as the model sees them.
 *
 * Twenty-three, named `studio_computer_*`, and each one earns its schema with
 * a job the capability exists for: see what is on screen, point and click,
 * type, find and drive windows, read a window's controls and act on them by
 * reference, and read or write the clipboard. The list a person handed over
 * as "the common pattern" had thirty; the difference is folding (ADR 0013,
 * one tool per capability): five kinds of click are one `click` with a
 * button and a count, two mouse-button tools are one, two clipboard tools
 * are one, and "switch display" is an argument on the picture it applies to.
 *
 * Two conventions run through all of them. **Coordinates are the display's
 * physical pixels**, and every picture says which frame it stands for, so a
 * model reads the frame and never the picture's own size. **A control is
 * addressed by an observation-scoped ref from `read_ui`**, which is the reliable way, or
 * by a coordinate when there is nothing to reference - a canvas, a game, a
 * window that exposes no accessibility tree.
 */

export interface ToolAnswer {
  readonly content: readonly { readonly type: string; readonly [key: string]: unknown }[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly run: (session: ComputerSession, input: Record<string, unknown>) => Promise<ToolAnswer>;
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
    if (observation["targetGone"] === true) lines.push("The previous target has closed or changed identity. Choose the intended replacement explicitly; foreground alone is not authority to continue.");
    for (const [field, label] of [["newWindows", "Opened"], ["closedWindows", "Closed"], ["candidates", "Recovery candidate"]] as const) {
      const rows = observation[field];
      if (Array.isArray(rows)) for (const row of rows) if (isRecord(row)) lines.push(`${label}: ${windowLine(row)}.`);
    }
    if (observation["truncated"] === true) lines.push("Window changes were truncated; list windows for the current inventory.");
    lines.push("Previous UI references are invalid. Observe the result and call read_ui again before using a control reference. Never repeat input just because verification is unavailable.");
  }
  return { content: [text(lines.join("\n"))], structuredContent: { observation } };
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
}

function asPicture(value: unknown): Picture {
  if (!isRecord(value) || typeof value["data"] !== "string") {
    throw new ComputerError("internal", { message: "The driver answered a picture without an image." });
  }
  return value as unknown as Picture;
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
  return `Display ${String(picture.display)}: ${region}.${scaled}`;
}

async function picture(
  session: ComputerSession,
  args: Record<string, unknown>,
): Promise<{ readonly line: string; readonly image: { type: "image"; data: string; mimeType: string } }> {
  const shot = asPicture(await session.request("screenshot", args));
  session.rememberFrame({ display: shot.display, width: shot.frameWidth, height: shot.frameHeight });
  return {
    line: frameLine(shot),
    image: { type: "image", data: shot.data, mimeType: shot.mimeType },
  };
}

/**
 * The ordinary answer from a tool that did something: what happened, where
 * the pointer is, and a picture of the display it acted on. The picture is a
 * JPEG scaled to 1280, the same trade the browser makes: "did it land" is
 * answered as well by a small frame as by a large one, and a tool exists for
 * the times a real screenshot is the point.
 */
async function acted(session: ComputerSession, said: string, display: number | undefined, result?: unknown): Promise<ToolAnswer> {
  const receipt = actionAnswer(said, result);
  try {
    const cursor = await session.request("cursor");
    const where = isRecord(cursor)
      ? `Pointer at (${String(cursor["x"])},${String(cursor["y"])}) on display ${String(cursor["display"])}.`
      : "";
    const shot = await picture(session, {
      ...(display === undefined ? {} : { display }),
      max: 1280,
      format: "jpeg",
    });
    return { ...receipt, content: [...receipt.content, text(`${where}\n${shot.line}`), shot.image] };
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
      "the picture stands for; give coordinates in that frame. Use zoom to read small text. " +
      "Give a window handle to picture just that window, wherever it is.",
    inputSchema: object({
      ...DISPLAY,
      window: { type: "number", description: "A handle from windows: picture only that window's rectangle." },
      format: {
        type: "string",
        enum: ["jpeg", "png"],
        description: "jpeg (default, smaller) or png (exact, for reading fine detail).",
      },
    }),
    run: async (session, input) => {
      const window = num(input, "window");
      const shot = await picture(session, {
        ...displayArg(input),
        ...(window === undefined ? {} : { window }),
        max: 1568,
        format: str(input, "format") ?? "jpeg",
      });
      return { content: [text(shot.line), shot.image] };
    },
  },

  {
    name: "studio_computer_zoom",
    description:
      "A close-up of one region of a display, at full resolution, for reading small text or " +
      "checking fine detail. Coordinates you give afterwards are still in the display's frame.",
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
      const shot = await picture(session, { ...displayArg(input), region, max: 1568, format: "png" });
      return { content: [text(shot.line), shot.image] };
    },
  },

  // ─── The pointer ──────────────────────────────────────────────────────
  {
    name: "studio_computer_cursor",
    description: "Where the pointer is now, and on which display.",
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
    inputSchema: object({ ...POINT, ...DISPLAY }, ["x", "y"]),
    run: async (session, input) => {
      const sent = await session.request("move", { ...displayArg(input), x: requiredNumber(input, "x"), y: requiredNumber(input, "y") });
      return acted(session, "Moved.", num(input, "display"), sent);
    },
  },

  {
    name: "studio_computer_click",
    description:
      "Click at a point on a display. One tool for every kind of click: choose the button, " +
      "how many times (2 for a double-click, 3 to select a line), and any keys to hold. " +
      "Prefer act with a complete ui_ reference from the latest read_ui when the control has one; click when it does not. " +
      "Copy the display index and display-relative centre from read_ui. After input, inspect the observation and read controls again; do not reuse references.",
    inputSchema: object(
      {
        ...POINT,
        button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." },
        count: { type: "number", description: "1, 2 or 3. Default 1." },
        ...MODIFIERS,
        ...DISPLAY,
      },
      ["x", "y"],
    ),
    run: async (session, input) => {
      const count = num(input, "count") ?? 1;
      if (count < 1 || count > 3) {
        throw new ComputerError("bad_input", { message: "count must be 1, 2 or 3." });
      }
      const sent = await session.request("click", {
        ...displayArg(input),
        x: requiredNumber(input, "x"),
        y: requiredNumber(input, "y"),
        button: str(input, "button") ?? "left",
        count,
        modifiers: str(input, "modifiers") ?? "",
      });
      const what = count === 1 ? "Clicked" : count === 2 ? "Double-clicked" : "Triple-clicked";
      return acted(session, withNote(`${what}.`, sent, "outside"), num(input, "display"), sent);
    },
  },

  {
    name: "studio_computer_drag",
    description: "Press at one point, move to another and release: drag and drop, or a selection by mouse.",
    inputSchema: object(
      {
        from: { type: "array", items: NUMBER, minItems: 2, maxItems: 2, description: "[x, y] to start at." },
        to: { type: "array", items: NUMBER, minItems: 2, maxItems: 2, description: "[x, y] to release at." },
        ...DISPLAY,
      },
      ["from", "to"],
    ),
    run: async (session, input) => {
      const from = input["from"];
      const to = input["to"];
      const isPoint = (v: unknown): v is [number, number] =>
        Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
      if (!isPoint(from) || !isPoint(to)) {
        throw new ComputerError("bad_input", { message: "Give from and to as [x, y]." });
      }
      const sent = await session.request("drag", { ...displayArg(input), from, to });
      return acted(session, withNote("Dragged.", sent, "outside"), num(input, "display"), sent);
    },
  },

  {
    name: "studio_computer_mouse_button",
    description:
      "Press and hold a mouse button, or release it, at the pointer's current position. " +
      "For the rare drag that needs something to happen in between; drag covers the ordinary case.",
    inputSchema: object(
      {
        action: { type: "string", enum: ["down", "up"] },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." },
      },
      ["action"],
    ),
    run: async (session, input) => {
      const action = required(input, "action");
      if (action !== "down" && action !== "up") {
        throw new ComputerError("bad_input", { message: "action must be down or up." });
      }
      const sent = await session.request("button", { action, button: str(input, "button") ?? "left" });
      return actionAnswer(action === "down" ? "Button held." : "Button released.", sent);
    },
  },

  {
    name: "studio_computer_scroll",
    description: "Scroll at a point, in a direction, by some wheel ticks.",
    inputSchema: object(
      {
        ...POINT,
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Wheel ticks. Default 3." },
        ...DISPLAY,
      },
      ["x", "y", "direction"],
    ),
    run: async (session, input) => {
      const direction = required(input, "direction");
      const sent = await session.request("scroll", {
        ...displayArg(input),
        x: requiredNumber(input, "x"),
        y: requiredNumber(input, "y"),
        direction,
        amount: num(input, "amount") ?? 3,
      });
      return acted(session, `Scrolled ${direction}.`, num(input, "display"), sent);
    },
  },

  // ─── The keyboard ─────────────────────────────────────────────────────
  {
    name: "studio_computer_type",
    description:
      "Type text into the window being worked in, at its keyboard focus. Newlines press Return. " +
      "Refused if another window has come to the front since it was opened, focused, read or clicked in. " +
      "For a shortcut use key; for a field that has a ui_ reference, set_value is exact.",
    inputSchema: object({ text: STRING }, ["text"]),
    run: async (session, input) => {
      const body = input["text"];
      if (typeof body !== "string") throw new ComputerError("bad_input", { message: "Give the text to type." });
      const sent = await session.request("type", { text: body });
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
    description: "Hold a key or chord for some seconds, then release it. For a game or a long-press.",
    inputSchema: object(
      {
        keys: { type: "string", description: 'The key or chord, joined with "+".' },
        seconds: { type: "number", description: "How long to hold. At most 30." },
      },
      ["keys", "seconds"],
    ),
    run: async (session, input) => {
      const keys = required(input, "keys");
      const seconds = Math.min(requiredNumber(input, "seconds"), 30);
      const sent = await session.request("hold", { keys, seconds });
      return actionAnswer(withFront(`Held ${keys} for ${String(seconds)} seconds.`, sent), sent);
    },
  },

  // ─── Windows and apps ─────────────────────────────────────────────────
  {
    name: "studio_computer_apps",
    description: "The applications with a window open right now, and which one is in front.",
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
              ? `window ${String(w["handle"])}: "${String(w["title"])}" (${String(w["app"])}) on display ${String(w["display"])} at (${String(w["x"])},${String(w["y"])}) ${String(w["width"])}x${String(w["height"])}${w["minimized"] === true ? ", minimized" : ""}${w["foreground"] === true ? ", in front" : ""}${w["target"] === true ? ", the window being worked in" : ""}`
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
    name: "studio_computer_focus",
    description: "Bring a window to the front by its handle from `windows`, restoring it if minimized.",
    inputSchema: object({ window: { type: "number", description: "The handle from windows." } }, ["window"]),
    run: async (session, input) => {
      const result = await session.request("focus", { window: requiredNumber(input, "window") });
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
      "maximized), whether it is the one in front, what is in front if not, the pointer and the displays. " +
      "The call to make when lost, or before keys, and cheap enough to make often.",
    inputSchema: object({}),
    run: async (session) => {
      const status = await session.request("status");
      if (!isRecord(status)) return answer("The desktop could not be asked.");
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
      return answer(lines.join("\n"));
    },
  },

  {
    name: "studio_computer_arrange",
    description:
      "Arrange a window by its handle: maximize (optionally on a given display), minimize, restore, move, " +
      "resize or close. Maximizing the window being worked in on one display is the surest way to keep " +
      "track of it: nothing overlaps it and every picture of that display shows it whole. Close is the " +
      "title bar's X, so an app may ask about unsaved work.",
    inputSchema: object(
      {
        window: { type: "number", description: "The handle from windows, open or status." },
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
      "file that takes a moment to open - and get its handle. Better than a fixed wait and a guess.",
    inputSchema: object(
      {
        text: { type: "string", description: 'Part of the title or app name: "Save As", "Notepad".' },
        seconds: { type: "number", description: "How long to wait at most. Default 10, at most 60." },
      },
      ["text"],
    ),
    run: async (session, input) => {
      const text = required(input, "text");
      const result = await session.request("wait_window", { text, seconds: num(input, "seconds") ?? "" });
      if (!isRecord(result) || result["found"] !== true) {
        return answer(`No window matching "${text}" appeared within ${String(isRecord(result) ? result["waited"] : "")} seconds.`);
      }
      const front = result["foreground"] === true ? " It is in front." : " It is not in front; focus it before keys.";
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
      "read or clicked in; it never reads whatever happens to be in front. References expire after any input, a new read, or driver restart. " +
      "Work one observed step at a time: choose the intended window, read it, act once, and inspect the returned observation and screenshot. " +
      "If a window closes or changes, use status/windows (or wait_for_window for a delayed transition), choose and focus the intended replacement explicitly, then read_ui again. " +
      "Never infer authority from foreground alone. A dispatched action is not a verified result; reobserve instead of replaying uncertain input. " +
      "Tool results report non-injected mouse/key activity observed since the last result, with current pointer and window state. " +
      "These updates do not stop computer use automatically. Reconcile them with your task and read fresh controls before continuing; key contents are never included. " +
      "Another conversation's live desktop ownership refuses competing input until it stops or its idle driver closes.",
    inputSchema: object({
      window: { type: "number", description: "A handle from windows or open. Defaults to the window being worked in." },
      all: { type: "boolean", description: "Include text and structure, not only controls." },
      depth: { type: "number", description: "How deep to walk. Default 12." },
      limit: { type: "number", description: "Most lines to return. Default 400." },
    }),
    run: async (session, input) => {
      const result = await session.request("read_ui", {
        window: num(input, "window") ?? "",
        all: input["all"] === true,
        depth: num(input, "depth") ?? "",
        limit: num(input, "limit") ?? "",
      });
      if (!isRecord(result)) return answer("The window could not be read.");
      const minimized = result["minimized"] === true ? " This window is minimized; focus it before acting on it." : "";
      const outline = typeof result["outline"] === "string" ? result["outline"] : "";
      return answer(
        `Window: ${windowName(result)}${minimized}\n\n${outline === "" ? "No controls were found. Try all: true, or a screenshot." : outline}`,
      );
    },
  },

  {
    name: "studio_computer_act",
    description:
      "Do what a control does, by reference: invoke a button or menu item, toggle a checkbox, " +
      "expand or collapse, select an item, focus a field, or scroll it into view. " +
      "Works without moving the pointer, which is what makes it reliable.",
    inputSchema: object(
      {
        ref: { type: "string", description: "The complete observation-scoped reference from the latest read_ui. Expired after any input or another read." },
        action: {
          type: "string",
          enum: ["invoke", "toggle", "expand", "collapse", "select", "focus", "scroll_into_view"],
          description: "Default invoke.",
        },
      },
      ["ref"],
    ),
    run: async (session, input) => {
      const result = await session.request("act", { ref: required(input, "ref"), action: str(input, "action") ?? "invoke" });
      return acted(session, isRecord(result) ? String(result["said"]) : "Done.", undefined, result);
    },
  },

  {
    name: "studio_computer_set_value",
    description: "Set a field's value directly, by reference. Exact and instant, where the field allows it.",
    inputSchema: object(
      { ref: { type: "string", description: "A reference from read_ui." }, value: STRING },
      ["ref", "value"],
    ),
    run: async (session, input) => {
      const value = input["value"];
      if (typeof value !== "string") throw new ComputerError("bad_input", { message: "Give the value as text." });
      const result = await session.request("set_value", { ref: required(input, "ref"), value });
      return acted(session, isRecord(result) ? String(result["said"]) : "Set.", undefined, result);
    },
  },

  {
    name: "studio_computer_select_text",
    description: "Select a range of characters in a text control, by reference, so it can be copied or replaced.",
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
      return actionAnswer(isRecord(result) ? String(result["said"]) : "Selected.", result);
    },
  },

  // ─── The rest ─────────────────────────────────────────────────────────
  {
    name: "studio_computer_clipboard",
    description: "Read what is on the clipboard as text, or put text on it.",
    inputSchema: object(
      {
        action: { type: "string", enum: ["read", "write"] },
        text: { type: "string", description: "The text to write. For write only." },
      },
      ["action"],
    ),
    run: async (session, input) => {
      const action = required(input, "action");
      if (action === "read") {
        const result = await session.request("clipboard", { action: "read" });
        const body = isRecord(result) && typeof result["text"] === "string" ? result["text"] : "";
        return answer(body === "" ? "The clipboard has no text." : `Clipboard:\n${body.slice(0, 20_000)}`);
      }
      if (action === "write") {
        const body = input["text"];
        if (typeof body !== "string") throw new ComputerError("bad_input", { message: "Give the text to write." });
        await session.request("clipboard", { action: "write", text: body });
        return answer(`Wrote ${String(body.length)} characters to the clipboard.`);
      }
      throw new ComputerError("bad_input", { message: "action must be read or write." });
    },
  },

  {
    name: "studio_computer_wait",
    description: "Wait some seconds for the screen to catch up. Use sparingly; most changes are quick.",
    inputSchema: object({ seconds: { type: "number", description: "At most 30." } }, ["seconds"]),
    run: async (session, input) => {
      const seconds = Math.min(Math.max(requiredNumber(input, "seconds"), 0), 30);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return acted(session, `Waited ${String(seconds)} seconds.`, undefined);
    },
  },

  {
    name: "studio_computer_stop",
    description:
      "End computer control for this conversation now: releases any held button or key and closes the driver. " +
      "Rarely needed - an idle driver closes itself, and the next tool call starts another.",
    inputSchema: object({}),
    run: async (session) => {
      const was = session.running;
      if (was) {
        // Anything left held would stay held after the driver dies, which is
        // the one state worse than a stuck pointer.
        await session.request("button", { action: "up", button: "left" }).catch(() => undefined);
        await session.request("button", { action: "up", button: "right" }).catch(() => undefined);
      }
      await session.close();
      return answer(was ? "Computer control has stopped." : "Computer control was not running.");
    },
  },
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export function definitions(): readonly Record<string, unknown>[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
