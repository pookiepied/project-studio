/**
 * The computer tools the conversation's own agent is offered in a voice call
 * (ADR 0059), held here because two places enforce it: the harness's tool
 * list and the computer server's refusal. A rule only one of them knew would
 * be the rule the other forgot.
 *
 * Looking, pointing things out, the lease, and short, bounded actions. Dragging, holding keys or
 * buttons, the clipboard, waiting, arranging windows and selecting text by
 * offsets are sustained or fiddly work for a task. Stop is the person's
 * control, not the agent's.
 */
export const VOICE_COMPUTER_TOOLS: ReadonlySet<string> = new Set([
  "displays", "screenshot", "zoom", "cursor", "status", "windows", "apps", "control",
  "read_ui", "act", "set_value", "click", "type", "key", "scroll", "focus", "open", "batch", "mark",
]);

/** One shape the person drew with Studio's drawing window, in the desktop's physical pixels. */
export interface DrawnShapeInput {
  readonly shape: "loop" | "line" | "dot" | "scribble";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The longest batch the conversation's own agent runs in a voice call. */
export const VOICE_BATCH_STEPS = 6;

/** The capability namespace of Studio's own computer server. */
export const COMPUTER_NAMESPACE = "mcp:studio-computer";

/**
 * Whether the voice agent is offered a tool: native `read` always (its own
 * image policy narrows it further), the computer tools above only while the
 * person is sharing the screen, and nothing else.
 */
export function voiceToolOffered(namespace: string, name: string, sharing: boolean): boolean {
  if (namespace === "native") return name === "read";
  if (namespace !== COMPUTER_NAMESPACE || !sharing) return false;
  return VOICE_COMPUTER_TOOLS.has(name.replace(/^studio_computer_/, ""));
}
