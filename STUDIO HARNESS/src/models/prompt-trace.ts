import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { logsDirectory } from "../platform/paths.js";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";

/**
 * What the prompt is made of, measured at the last point we own it.
 *
 * ---- Development scaffolding, and it leaves before release -----------------
 *
 * This is here to answer questions while Studio is being built, not to ship.
 * It has no user-facing value: nobody outside development will ever create the
 * switch file or read the output. Delete this module, its call in
 * `models/adapters/local-adapter.ts`, and the switch file when the product is
 * done. Recorded here rather than in a tracking list because the file that
 * has to be deleted is the one place the instruction cannot be missed.
 *
 * ---- This is a diagnostic, not the tracing system --------------------------
 *
 * Tracing is ADR 0004: OpenTelemetry through `@flue/opentelemetry`, with the
 * exporter chosen in `observability/config.ts`. Durations, model-call spans,
 * and `gen_ai.usage` token counts all live there, and anything wanted about
 * *how a call went* belongs there rather than here.
 *
 * This exists for the one question those spans structurally cannot answer.
 * GenAI semantic conventions record token totals; they do not record what the
 * prompt was made of. When a request is unexpectedly large, the useful fact is
 * whether the weight is the system prompt, a tool schema, or history - and
 * that decomposition has to be taken before the request is serialised, which
 * is here.
 *
 * Keep it to that. The moment this wants durations, response usage, or
 * correlation across calls, the answer is the exporter, not another field.
 *
 * A provider's dashboard reports one number for the whole request, which is
 * enough to know a prompt is too big and useless for knowing why. This writes
 * the breakdown - system prompt, each tool, each message - immediately before
 * the request leaves for the provider, so the same question can be answered
 * from our side without a key, a network call, or a paid turn.
 *
 * ---- Off unless asked for --------------------------------------------------
 *
 * Enabled by `STUDIO_PROMPT_TRACE=1`. A trace on every request would write a
 * file nobody reads and would put a synchronous write on the path of every
 * turn; the diagnostic is worth having and is not worth paying for constantly.
 *
 * ---- Sizes, and names, and nothing else ------------------------------------
 *
 * Character counts and tool names, never the content of a message. A prompt
 * trace that quoted the conversation would be a transcript in a log file, and
 * an API key pasted into a chat would land in it. Sizes answer the question
 * this exists for; text would answer it slightly faster and create a place
 * secrets accumulate.
 *
 * Characters rather than tokens because tokenisation belongs to the provider
 * and differs between them. A ratio near four characters per token is close
 * enough to tell a 4,000-token prompt from a 17,000-token one, which is the
 * distinction this is for.
 */

/** The switch: create this file to trace, delete it to stop. */
export function promptTraceSwitchPath(): string {
  return join(logsDirectory(), "prompt-trace.on");
}

/**
 * Whether to trace, answered per call and from the filesystem.
 *
 * Two things forced this shape. An environment variable cannot be set for a
 * process the desktop app spawns for itself - the harness inherits whatever
 * launched the window, which on a normal install is the shell that started
 * Explorer. And a `const ENABLED = process.env...` at module scope is a
 * build-time constant to the bundler, which folded it to `false` and removed
 * this entire file from the build. Both were measured rather than assumed.
 *
 * A file the user can create answers both: it works for a GUI-launched
 * process, it can be turned on and off without a restart, and it cannot be
 * folded away. The environment variable still works for a harness started by
 * hand.
 */
function enabled(): boolean {
  if (process.env.STUDIO_PROMPT_TRACE === "1") return true;
  try {
    return existsSync(promptTraceSwitchPath());
  } catch {
    return false;
  }
}

/** One line is roughly a kilobyte, so this holds a few thousand requests. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * One generation of rotation, and no more.
 *
 * A switch someone turns on to answer a question and forgets to turn off must
 * not fill a disk. Two files bound it, and the older one is overwritten rather
 * than numbered upward: this is a diagnostic being read within minutes of
 * being written, so history past the previous file has no reader.
 */
function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size < MAX_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // No file yet, or a rename another process won. Either way the append
    // that follows is still correct.
  }
}

/** A tool's own name, wherever this Pi version happens to keep it. */
function nameOf(tool: unknown): string | undefined {
  if (typeof tool !== "object" || tool === null) return undefined;
  const record: Record<string, unknown> = { ...tool };
  for (const key of ["name", "label", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** Synchronous on purpose: a trace that loses its last line before a crash. */
export function tracePrompt(
  target: string,
  context: Context,
  options?: SimpleStreamOptions,
): void {
  if (!enabled()) return;

  try {
    // An array in every observed case, but keyed objects are a shape Pi has
    // used, so both are read. The name comes off the tool itself rather than
    // from the key: an array's key is its index, which is what the first
    // version of this reported and is useless for deciding what to trim.
    const entries = Array.isArray(context.tools)
      ? context.tools
      : Object.values(context.tools ?? {});
    const tools = entries.map((tool, index) => ({
      name: nameOf(tool) ?? `#${index}`,
      chars: JSON.stringify(tool).length,
    }));
    const messages = (context.messages ?? []).map((message) => ({
      role: message.role,
      chars: JSON.stringify(message).length,
    }));

    const systemChars = (context.systemPrompt ?? "").length;
    const toolChars = tools.reduce((total, tool) => total + tool.chars, 0);
    const messageChars = messages.reduce((total, message) => total + message.chars, 0);

    const line = {
      at: new Date().toISOString(),
      target,
      reasoning: options?.reasoning ?? null,
      total: { chars: systemChars + toolChars + messageChars },
      system: { chars: systemChars },
      tools: { count: tools.length, chars: toolChars, each: tools },
      messages: { count: messages.length, chars: messageChars, each: messages },
    };

    mkdirSync(logsDirectory(), { recursive: true });
    const path = join(logsDirectory(), "prompt-trace.jsonl");
    rotateIfLarge(path);
    appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // A diagnostic that can fail a turn is worse than no diagnostic. An
    // unwritable log directory, a full disk, or a shape this does not expect
    // all end here rather than in the run.
  }
}
