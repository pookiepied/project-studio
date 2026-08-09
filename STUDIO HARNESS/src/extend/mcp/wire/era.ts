import {
  isJsonRpcErrorResponse,
  isJsonRpcSuccessResponse,
  isMcpErrorCode,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
} from "./jsonrpc.js";

/**
 * Deciding which MCP a server speaks, before anything depends on the answer.
 *
 * The protocol split in two. Revisions from `2024-11-05` to `2025-11-25`
 * establish a session with an `initialize` handshake; `2026-07-28` removed that
 * handshake and replaced it with `server/discover`, which every modern server
 * MUST implement. A server answers to one of them, and we cannot know which
 * from a URL or a command line.
 *
 * The spec's own words are used here — **legacy** and **modern** — rather than
 * "old" and "new". A client that speaks both is dual-era, and both eras are
 * supported because a server downloaded today is overwhelmingly likely to be
 * legacy, while everything written from now on will not be.
 *
 * ## The probe
 *
 * `server/discover` goes first, because the modern era is the one we prefer and
 * because asking the legacy question first would mean every modern server pays
 * for a handshake it removed.
 *
 * Three outcomes, and the middle one is the one that is easy to get wrong:
 *
 * | What comes back | Era | What follows |
 * |---|---|---|
 * | A discover result | modern | proceed |
 * | An error a modern server would raise | modern | retry with a version it supports; **do not fall back** |
 * | Anything else, or nothing | legacy | `initialize` |
 *
 * The middle row exists because a modern server that refuses our protocol
 * version answers with an error, and treating any error as "not modern" would
 * silently downgrade a server that told us exactly what it was. Falling back
 * there would then fail a second time, and the user would be shown the legacy
 * failure for a modern server.
 *
 * **Not keyed on one error code.** `-32022` is the version error specifically,
 * and the whole `-32020`..`-32099` band is reserved for MCP — a server raising
 * any of them has demonstrated it knows the modern vocabulary. Keying on
 * `-32022` alone would misread every other modern refusal as legacy.
 */

export type McpEra = "modern" | "legacy";

export type EraProbe =
  | { readonly era: "modern"; readonly result: unknown }
  /**
   * Modern, and it refused this version. `supported` is what the server said it
   * speaks, when it said so — the retry picks from that rather than guessing.
   */
  | {
      readonly era: "modern";
      readonly unsupportedVersion: true;
      readonly supported: readonly string[];
    }
  | { readonly era: "legacy"; readonly why: LegacyReason };

/** Why we concluded a server is legacy. Carried so a failure can say it. */
export type LegacyReason =
  /** It does not know `server/discover`. The ordinary legacy answer. */
  | "method_not_found"
  /** It answered with something that is not a JSON-RPC response at all. */
  | "not_a_response"
  /** It said nothing in time. */
  | "no_answer";

function versionsFrom(data: unknown): readonly string[] {
  if (typeof data !== "object" || data === null) return [];
  const supported = (data as { supported?: unknown }).supported;
  if (!Array.isArray(supported)) return [];
  return supported.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Reads one answer to `server/discover` and names the era.
 *
 * Pure, so the decision can be tested against every shape a server might send
 * without starting one. `undefined` means the request produced no response —
 * a timeout or a dead connection — and is the same evidence as a malformed
 * answer: no demonstration of modern vocabulary, so legacy.
 */
export function readEraProbe(response: unknown): EraProbe {
  if (response === undefined) return { era: "legacy", why: "no_answer" };

  if (isJsonRpcSuccessResponse(response)) {
    return { era: "modern", result: response.result };
  }

  if (isJsonRpcErrorResponse(response)) {
    const { code } = response.error;

    if (code === MCP_UNSUPPORTED_PROTOCOL_VERSION) {
      return {
        era: "modern",
        unsupportedVersion: true,
        supported: versionsFrom(response.error.data),
      };
    }

    // Any code in the reserved band is modern vocabulary. A legacy server has
    // no reason to raise one, and a modern server refusing us for some other
    // reason must not be mistaken for a legacy one.
    if (isMcpErrorCode(code)) {
      return { era: "modern", result: undefined };
    }

    // "I do not know that method" is precisely what a legacy server says to
    // `server/discover`, and it is the expected path rather than a fault.
    return { era: "legacy", why: "method_not_found" };
  }

  return { era: "legacy", why: "not_a_response" };
}

/**
 * Whether an era, once decided, may be reused.
 *
 * Era is a property of the server, not of a request, so it is cached for the
 * life of a process (stdio) or of an origin (HTTP). Re-probing every call would
 * pay the cost forever to learn something that cannot change while the process
 * is up. A restart re-probes, which is what makes an upgraded server pick up
 * its new era without anyone clearing anything.
 */
export const ERA_IS_CACHED_PER_CONNECTION = true;
