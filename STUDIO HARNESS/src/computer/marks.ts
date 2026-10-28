import { createStudioUuid } from "../contracts/uuid.js";
import { ComputerError } from "./errors.js";

/**
 * Marks the agent shows on the person's screen: "this one", a ring around a
 * button, a box around a paragraph, an arrow from one place to another
 * (ADR 0059).
 *
 * Pointing is the half of talking about a screen that words do badly, and it
 * is the half that cannot go wrong: a mark sends no input, so it needs no
 * desktop and no fresh look, and it disappears by itself. The server only
 * checks and places marks; Studio's own window draws them, above everything,
 * passing clicks through. Coordinates are the display's physical pixels, the
 * same as a click's, so "show me where you would click" and the click land
 * in one place.
 */

export const MAX_MARKS = 6;
export const DEFAULT_MARK_SECONDS = 6;
export const MAX_MARK_SECONDS = 30;
const LABEL_LIMIT = 48;

export type MarkKind = "point" | "ring" | "box" | "arrow";

export interface Mark {
  readonly kind: MarkKind;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly toX?: number;
  readonly toY?: number;
  readonly label?: string;
}

export interface DisplayBounds {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What Studio's window is told to draw: the display's place on the desktop, and marks relative to it. */
export interface MarkSet {
  readonly id: string;
  readonly display: DisplayBounds;
  readonly marks: readonly Mark[];
  readonly expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function isKind(value: unknown): value is MarkKind {
  return value === "point" || value === "ring" || value === "box" || value === "arrow";
}

/** Screen text cannot steer how a label renders: one plain line, cut short. */
function label(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = [...value].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").trim().slice(0, LABEL_LIMIT);
  return line === "" ? undefined : line;
}

export function displaysFrom(value: unknown): readonly DisplayBounds[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): DisplayBounds[] => {
    if (!isRecord(item)) return [];
    const index = finite(item["index"]); const x = finite(item["x"]); const y = finite(item["y"]);
    const width = finite(item["width"]); const height = finite(item["height"]);
    return index === undefined || x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0
      ? [] : [{ index, x, y, width, height }];
  });
}

function inside(display: DisplayBounds, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < display.width && y < display.height;
}

/** Checks the model's marks against the display they are for; refuses rather than clamps, so nothing points somewhere unintended. */
export function markSet(input: Record<string, unknown>, displays: readonly DisplayBounds[], now: number): MarkSet {
  const index = finite(input["display"]);
  if (index === undefined) throw new ComputerError("bad_input", { message: "Give the display the marks are on, by its index from a screenshot or displays." });
  const display = displays.find((candidate) => candidate.index === index);
  if (display === undefined) throw new ComputerError("bad_input", { message: `There is no display ${String(index)}.` });
  const given = input["marks"];
  if (!Array.isArray(given) || given.length === 0) throw new ComputerError("bad_input", { message: "Give at least one mark, or use clear." });
  if (given.length > MAX_MARKS) throw new ComputerError("bad_input", { message: `Show at most ${String(MAX_MARKS)} marks at once, so they stay readable.` });
  const marks = given.map((item: unknown, position): Mark => {
    if (!isRecord(item) || !isKind(item["kind"])) throw new ComputerError("bad_input", { message: `Mark ${String(position + 1)} needs a kind: point, ring, box or arrow.` });
    const kind = item["kind"];
    const x = finite(item["x"]); const y = finite(item["y"]);
    if (x === undefined || y === undefined || !inside(display, x, y)) {
      throw new ComputerError("bad_input", { message: `Mark ${String(position + 1)} is not on display ${String(index)}, which is ${String(display.width)}x${String(display.height)}.` });
    }
    const text = label(item["label"]);
    const base = { kind, x, y, ...(text === undefined ? {} : { label: text }) };
    if (kind === "ring" || kind === "box") {
      const width = finite(item["width"]); const height = finite(item["height"]);
      if (width === undefined || height === undefined || width <= 0 || height <= 0 || !inside(display, x + width - 1, y + height - 1)) {
        throw new ComputerError("bad_input", { message: `Mark ${String(position + 1)} needs a width and height that stay on the display.` });
      }
      return { ...base, width, height };
    }
    if (kind === "arrow") {
      const toX = finite(item["toX"]); const toY = finite(item["toY"]);
      if (toX === undefined || toY === undefined || !inside(display, toX, toY)) {
        throw new ComputerError("bad_input", { message: `Mark ${String(position + 1)} needs toX and toY on the display: the arrow points from x,y to there.` });
      }
      return { ...base, toX, toY };
    }
    return base;
  });
  const asked = finite(input["seconds"]);
  const seconds = Math.min(MAX_MARK_SECONDS, Math.max(1, asked ?? DEFAULT_MARK_SECONDS));
  return { id: createStudioUuid(), display, marks, expiresAt: now + seconds * 1_000 };
}
