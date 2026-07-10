/**
 * EngineGlyph — the active engine's mark (Studio vs Claude) used by the chat
 * status line. There is no wrapper motion and no enclosing circle: the marks
 * animate their OWN parts.
 *
 *   • "idle" — completely still. Reads as "waiting".
 *   • "busy" — the mark's own parts ripple (Studio tiles / Claude legs). Reads
 *     as "working right now" without swinging the whole glyph.
 */

import type { ChatEngine } from "@/cliBridges/types";
import { StudioMark } from "@/ui/brand/StudioMark";
import { ClaudeCodeIcon } from "@/ui/brand";

export type GlyphState = "idle" | "busy";

export function EngineGlyph({
  engine,
  state,
  size = 16,
}: {
  engine: ChatEngine;
  state: GlyphState;
  size?: number;
}) {
  const busy = state === "busy";

  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {engine === "claude" ? (
        <ClaudeCodeIcon size={size} busy={busy} />
      ) : (
        <StudioMark size={size} busy={busy} className="text-gray-500 dark:text-gray-400" />
      )}
    </span>
  );
}
