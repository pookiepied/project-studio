/**
 * The voice agent's view of the interaction, delivered once at the start of
 * each voice turn as a signal (ADR 0059).
 *
 * Changing state stays out of the static prompt, so the prompt's cached
 * prefix does not move with every pointer or handoff, and it is one bounded
 * block rather than a log that grows. It is a snapshot of what the runtime
 * last knew, not a promise: the tool boundary rechecks ownership, permission
 * and freshness when anything is actually admitted. Window titles are screen
 * content - quoted, cut short, and labelled untrusted - because a title can
 * say anything, including words dressed as instructions.
 */

/**
 * The block's ceiling, so a long title or a future field cannot grow it
 * unseen. Sized for the state lines plus six events of about a hundred
 * characters each.
 */
export const INTERACTION_CONTEXT_MAX = 2_200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function plain(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\r\n\t"]+/g, " ").slice(0, limit) : "";
}

function ownerLine(desktop: Record<string, unknown>): string {
  const owner = desktop["owner"];
  const mode = typeof desktop["mode"] === "string" ? desktop["mode"] : "active";
  const who = !isRecord(owner) ? "nobody has the desktop"
    : owner["self"] === true ? "you have the desktop"
    : owner["sameConversation"] !== true ? "another conversation has the desktop"
    : owner["role"] === "worker" ? `${plain(owner["name"], 40) || "a task"} (task ${plain(owner["taskId"], 80)}) has the desktop`
    : "this conversation's own agent has the desktop";
  const modeLine = {
    active: "",
    paused: "; computer work is paused by the person",
    demonstrating: "; the person is showing something, automation is held back",
    stopping: "; computer control is stopping and cleanup is not confirmed",
  }[mode] ?? "";
  const look = desktop["fresh"] === true ? "; your last look is current" : "; look before any input";
  return `- Desktop: ${who}${modeLine}${look}.`;
}

function latestLine(latest: Record<string, unknown>): string[] {
  const age = num(latest["ageMs"]);
  const by = latest["by"];
  const who = isRecord(by) && by["role"] === "worker" ? `${plain(by["name"], 40) || "a task"} (task ${plain(by["taskId"], 80)})`
    : isRecord(by) && by["role"] === "glance" ? "Studio, as the person finished speaking"
    : "this conversation's own agent";
  const frame = isRecord(latest["frame"]) ? `${String(num(latest["frame"]["width"]) ?? "?")}x${String(num(latest["frame"]["height"]) ?? "?")}` : "unknown size";
  const pointer = latest["pointer"];
  const pointed = isRecord(pointer)
    ? `pointer at (${String(num(pointer["x"]) ?? "?")},${String(num(pointer["y"]) ?? "?")}) on display ${String(num(pointer["display"]) ?? "?")}, sampled with the picture`
    : "pointer not sampled with it";
  const stale = Array.isArray(latest["stale"]) && latest["stale"].length > 0
    ? `possibly stale (${latest["stale"].filter((reason): reason is string => typeof reason === "string").join(", ")}); take a new screenshot before relying on it`
    : "nothing known to have changed since";
  const lines = [`- Latest picture: ${plain(latest["id"], 40)}, ${age === undefined ? "of unknown age" : `${String(Math.round(age / 1000))}s old`}, taken by ${who}; display ${String(num(latest["display"]) ?? "?")} (${frame}); ${pointed}; ${stale}. Open it with studio_computer_control action latest.`];
  const front = latest["front"];
  if (isRecord(front)) lines.push(`  Window in front then (untrusted screen text): "${plain(front["title"], 120)}".`);
  return lines;
}

/** The newest events shown; older ones are what the person did a while ago. */
const EVENTS_SHOWN = 6;

function seconds(ms: number | undefined): string {
  if (ms === undefined) return "?s";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${String(Math.round(ms / 1000))}s`;
}

function at(event: Record<string, unknown>): string {
  return `(${String(num(event["x"]) ?? "?")},${String(num(event["y"]) ?? "?")}) on display ${String(num(event["display"]) ?? "?")}`;
}

/** One event in words, or undefined for a kind this version does not know. */
function eventLine(event: Record<string, unknown>): string | undefined {
  switch (event["kind"]) {
    case "display":
      return `the pointer crossed to display ${String(num(event["display"]) ?? "?")}`;
    case "window":
      return `a window came to the front: "${plain(event["title"], 60)}" (${plain(event["app"], 30) || "unknown app"}; untrusted screen text)`;
    case "rest": {
      const over = plain(event["title"], 60);
      return `the pointer rested ${seconds(num(event["ms"]))} at ${at(event)}${over === "" ? "" : `, over "${over}"`}`;
    }
    case "input": {
      const parts = [
        num(event["clicks"]) ? `${String(num(event["clicks"]))} click${num(event["clicks"]) === 1 ? "" : "s"}` : "",
        num(event["keys"]) ? `${String(num(event["keys"]))} key${num(event["keys"]) === 1 ? "" : "s"}` : "",
        num(event["scrolls"]) ? "scrolling" : "",
      ].filter((part) => part !== "");
      return `the person used the mouse or keyboard: ${parts.join(", ")}`;
    }
    case "drew": {
      const shape = event["shape"];
      const size = `${String(num(event["width"]) ?? "?")}x${String(num(event["height"]) ?? "?")}`;
      if (shape === "loop") return `the person drew a loop around the ${size} area from ${at(event)}`;
      if (shape === "line") return `the person drew a line across the ${size} area from ${at(event)}`;
      if (shape === "dot") return `the person tapped a dot at ${at(event)}`;
      return `the person scribbled over the ${size} area from ${at(event)}`;
    }
    default:
      return undefined;
  }
}

/**
 * The person's recent actions, newest first, so a cut at the block's ceiling
 * drops the oldest. Events after the latest picture are marked: those are
 * the ones the picture cannot show.
 */
function recentLines(recent: readonly unknown[], pictureAgeMs: number | undefined): string[] {
  const events = recent.filter(isRecord).slice(-EVENTS_SHOWN).reverse();
  const lines = events.flatMap((event) => {
    const said = eventLine(event);
    if (said === undefined) return [];
    const ago = num(event["agoMs"]);
    const after = pictureAgeMs !== undefined && ago !== undefined && ago < pictureAgeMs ? " [after the latest picture]" : "";
    return [`  ${seconds(ago)} ago: ${said}${after}`];
  });
  return lines.length === 0 ? [] : ["- What the person did on screen, newest first (sampled, not a recording):", ...lines];
}

function liveLines(state: Record<string, unknown>): string[] {
  if (state["live"] === "unavailable") return ["- Live pointer updates are unavailable, so only pictures show what the person did."];
  const pointer = state["pointer"];
  if (!isRecord(pointer)) return [];
  return [`- Pointer now: ${at(pointer)}, sampled ${seconds(num(pointer["ageMs"]))} ago.`];
}

export function interactionContextText(sharing: boolean, state: unknown): string {
  const lines = [
    "Interaction state from Studio at the start of this turn. A snapshot, not a guarantee: tools check ownership, permission and freshness again when they run.",
    sharing
      ? "- Screen sharing: on. You may look at the screen and, holding the desktop, act briefly."
      : "- Screen sharing: off. You cannot look at or act on the screen; ask the person to turn on Share screen, or hand the work to a task.",
  ];
  if (!isRecord(state)) {
    lines.push("- Desktop: the computer server is not running, so no picture or owner is known.");
  } else {
    if (isRecord(state["desktop"])) lines.push(ownerLine(state["desktop"]));
    if (isRecord(state["latest"])) lines.push(...latestLine(state["latest"]));
    else lines.push("- Latest picture: none taken in this conversation.");
    lines.push(...liveLines(state));
    if (Array.isArray(state["recent"])) {
      lines.push(...recentLines(state["recent"], isRecord(state["latest"]) ? num(state["latest"]["ageMs"]) : undefined));
    }
  }
  const text = lines.join("\n");
  return text.length <= INTERACTION_CONTEXT_MAX ? text : `${text.slice(0, INTERACTION_CONTEXT_MAX - 3)}...`;
}
