import type { ToolAnswer } from "./tools.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0;
}
function window(value: unknown): { handle: number; title: string } | null {
  return record(value) && typeof value["handle"] === "number" && typeof value["title"] === "string"
    ? { handle: value["handle"], title: value["title"].slice(0, 1024) } : null;
}

/** Product context only; existing gated MCP recording owns diagnostic capture. */
export class InputUpdates {
  #latest: Record<string, unknown> | undefined;
  #moves = 0;
  #buttons = 0;
  #wheels = 0;
  #keys = 0;
  #truncated = false;

  get hasUpdates(): boolean { return this.#latest !== undefined; }

  add(value: unknown): void {
    if (!record(value) || typeof value["available"] !== "boolean") return;
    this.#moves += count(value["moves"]); this.#buttons += count(value["buttons"]);
    this.#wheels += count(value["wheels"]); this.#keys += count(value["keys"]);
    this.#truncated ||= value["truncated"] === true || Math.max(this.#moves, this.#buttons, this.#wheels, this.#keys) > 1_000_000;
    this.#moves = count(this.#moves); this.#buttons = count(this.#buttons);
    this.#wheels = count(this.#wheels); this.#keys = count(this.#keys);
    const cursor = value["cursor"];
    this.#latest = {
      available: value["available"], source: "non_injected_input", ageMs: count(value["ageMs"]),
      cursor: record(cursor) ? { x: count(cursor["x"]), y: count(cursor["y"]), display: count(cursor["display"]) } : null,
      target: window(value["target"]), front: window(value["front"]),
      stateAvailable: value["stateAvailable"] === true,
    };
  }

  decorate(result: ToolAnswer): ToolAnswer {
    if (this.#latest === undefined) return result;
    const activity = { ...this.#latest, moves: this.#moves, buttons: this.#buttons, wheels: this.#wheels, keys: this.#keys, truncated: this.#truncated };
    const message = this.#moves + this.#buttons + this.#wheels + this.#keys > 0
      ? `User interaction observed (non-injected input): ${activity.moves} mouse moves, ${activity.buttons} button events, ${activity.wheels} wheel events, ${activity.keys} keyboard events. ${this.#truncated ? "Activity counts were truncated. " : ""}Key contents were not collected. Current state: ${JSON.stringify(this.#latest)}. ${this.#latest["available"] === true ? "" : "Physical input monitoring is now unavailable. "}Reobserve the intended controls before continuing; do not repeat an uncertain action. Computer use has not been stopped automatically.`
      : "Physical input monitoring is unavailable. Absence of an interaction report does not prove that the person did not interact. Computer use has not been stopped automatically.";
    return { ...result, content: [...result.content, { type: "text", text: message }], structuredContent: { ...result.structuredContent, userInput: activity } };
  }
}
