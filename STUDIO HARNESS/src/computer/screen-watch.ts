import { isRecord } from "../serve/stdio.js";
import { frontFrom, pointerFrom, type FrontWindow, type Pointer } from "./observations.js";

/**
 * What the person did on a shared screen between pictures, as a short list of
 * events rather than a stream of frames (ADR 0059).
 *
 * A model in a voice call cannot watch video, and a picture every second
 * would bury it and the call's budget. What it actually needs to answer
 * "did you see this?" is narrower: where the pointer came to rest, when it
 * crossed to another display, which window came to the front, and that the
 * person clicked or typed - so it knows its last picture is old and where to
 * look next. Those are sampled cheaply twice a second while sharing is on and
 * folded into events here: a rest is reported once however long it lasts,
 * movement in between is not reported at all, and input is counted, never
 * recorded. The list is short and expires, so the turn's context stays a
 * paragraph however long the person has been sharing.
 */

/** How far the pointer may drift and still count as resting where it was. */
export const REST_RADIUS = 16;
/** How long the pointer must stay put to count as pointing at something. */
export const REST_MS = 700;
/** How long an event is kept. */
export const EVENT_WINDOW_MS = 60_000;
/** The most events kept, newest last. */
export const MAX_EVENTS = 24;
/** Input within this long of the previous input joins the same event. */
const INPUT_JOIN_MS = 2_000;

export interface InputCounts {
  readonly buttons: number;
  readonly keys: number;
  readonly wheels: number;
}

export interface PulseSample {
  readonly at: number;
  readonly pointer: Pointer;
  readonly front: FrontWindow | null;
  /** Running totals since the driver last reported input to a tool result. */
  readonly input: InputCounts;
}

/** A shape the person drew on screen, in display-relative pixels. */
export interface DrawnShape {
  readonly shape: "loop" | "line" | "dot" | "scribble";
  readonly display: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ScreenEvent =
  | { readonly kind: "display"; readonly at: number; readonly display: number }
  | { readonly kind: "window"; readonly at: number; readonly app: string; readonly title: string; readonly display?: number }
  | { readonly kind: "rest"; readonly at: number; readonly display: number; readonly x: number; readonly y: number; ms: number; readonly title?: string }
  | { readonly kind: "input"; at: number; clicks: number; keys: number; scrolls: number }
  | ({ readonly kind: "drew"; readonly at: number } & DrawnShape);

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** A pulse answer from the driver, or undefined when it does not have the shape of one. */
export function sampleFrom(value: unknown, at: number): PulseSample | undefined {
  if (!isRecord(value)) return undefined;
  const pointer = pointerFrom(value["pointer"]);
  if (pointer === null) return undefined;
  const input = isRecord(value["input"]) ? value["input"] : {};
  return {
    at, pointer, front: frontFrom(value["front"]),
    input: { buttons: count(input["buttons"]), keys: count(input["keys"]), wheels: count(input["wheels"]) },
  };
}

export class ScreenWatch {
  readonly #events: ScreenEvent[] = [];
  #last: PulseSample | undefined;
  #anchor: { display: number; x: number; y: number; since: number; rest?: Extract<ScreenEvent, { kind: "rest" }> } | undefined;
  #totals: InputCounts = { buttons: 0, keys: 0, wheels: 0 };

  /** Folds one sample in; answers whether the person's own clicks, keys or wheel showed up in it. */
  sample(sample: PulseSample): boolean {
    const previous = this.#last;
    this.#last = sample;
    if (previous !== undefined && previous.pointer.display !== sample.pointer.display) {
      this.#push({ kind: "display", at: sample.at, display: sample.pointer.display });
    }
    if (sample.front !== null && sample.front.handle !== previous?.front?.handle) {
      // The first sample only sets the baseline: the window that was already
      // in front when sharing began is not something the person just did.
      if (previous !== undefined) this.#push({ kind: "window", at: sample.at, app: sample.front.app.slice(0, 64), title: sample.front.title.slice(0, 80) });
    }
    this.#rest(sample);
    return this.#input(sample);
  }

  #rest(sample: PulseSample): void {
    const { display, x, y } = sample.pointer;
    const anchor = this.#anchor;
    if (anchor === undefined || anchor.display !== display || Math.hypot(anchor.x - x, anchor.y - y) > REST_RADIUS) {
      this.#anchor = { display, x, y, since: sample.at };
      return;
    }
    const still = sample.at - anchor.since;
    if (still < REST_MS) return;
    if (anchor.rest === undefined) {
      const title = sample.front?.title.slice(0, 80);
      anchor.rest = { kind: "rest", at: anchor.since, display, x: anchor.x, y: anchor.y, ms: still, ...(title === undefined ? {} : { title }) };
      this.#push(anchor.rest);
    } else {
      anchor.rest.ms = still;
    }
  }

  // The driver's totals run from its last tool result, so they drop back to
  // zero whenever a tool answers; a drop means a fresh run, not negative input.
  #input(sample: PulseSample): boolean {
    const delta = (key: keyof InputCounts): number => {
      const now = sample.input[key];
      const before = this.#totals[key];
      return now >= before ? now - before : now;
    };
    const clicks = delta("buttons"); const keys = delta("keys"); const scrolls = delta("wheels");
    this.#totals = sample.input;
    if (clicks + keys + scrolls === 0) return false;
    // The last input, not the last event: a rest reported in the middle of
    // typing is not a break in the typing.
    const last = this.#events.findLast((event) => event.kind === "input");
    if (last?.kind === "input" && sample.at - last.at <= INPUT_JOIN_MS) {
      last.at = sample.at; last.clicks += clicks; last.keys += keys; last.scrolls += scrolls;
    } else {
      this.#push({ kind: "input", at: sample.at, clicks, keys, scrolls });
    }
    return true;
  }

  /** Something the person drew on the screen. */
  drew(at: number, shape: DrawnShape): void {
    this.#push({ kind: "drew", at, ...shape });
  }

  #push(event: ScreenEvent): void {
    this.#events.push(event);
    while (this.#events.length > MAX_EVENTS) this.#events.shift();
  }

  /** Where the pointer is now, as of the newest sample. */
  get pointer(): (Pointer & { readonly at: number }) | undefined {
    const last = this.#last;
    return last === undefined ? undefined : { ...last.pointer, at: last.at };
  }

  get front(): FrontWindow | null {
    return this.#last?.front ?? null;
  }

  /** The events still inside the window, oldest first, each with its age. */
  recent(now: number): readonly (ScreenEvent & { readonly agoMs: number })[] {
    while (this.#events.length > 0 && (this.#events[0]?.at ?? now) < now - EVENT_WINDOW_MS) this.#events.shift();
    return this.#events.map((event) => ({ ...event, agoMs: Math.max(0, now - event.at) }));
  }
}
