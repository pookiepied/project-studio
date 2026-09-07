import { describe, expect, it } from "vitest";

import { mapStopReason } from "@earendil-works/pi-ai/api/google-shared";

/**
 * A finish reason from a remote API is an open set.
 *
 * Google returned `MALFORMED_RESPONSE`, which is not in the `FinishReason`
 * enum of the `@google/genai` version pi-ai pins, and pi's mapper treated the
 * enum as closed: its default branch threw. The throw happened mid-stream, so
 * a live turn died with "Unhandled stop reason: MALFORMED_RESPONSE" instead of
 * ending as a provider error the person could see and retry.
 *
 * pi-ai 0.85.1 - the newest release - still throws, and still pins the same
 * SDK, so there was nothing to upgrade to. The vendored patch makes an
 * unrecognized reason answer "error", which is what every other non-stop
 * reason in that switch already answers.
 *
 * The patch fixes the same defect in pi's Anthropic and OpenAI Responses
 * mappers, which carried identical throws - the Anthropic one directly under a
 * comment promising to handle new values gracefully. Neither of those mappers
 * is exported from the package, so only the Google one can be reached from a
 * test; the others are covered by the patch and by reading it.
 */
describe("an unknown provider stop reason", () => {
  it("ends the turn as an error instead of throwing", () => {
    // The value Google actually sent. Cast through the enum's own type is not
    // available here - the point is precisely that the enum does not name it.
    const reason: unknown = "MALFORMED_RESPONSE";
    expect(mapStopReason(reason as Parameters<typeof mapStopReason>[0])).toBe("error");
  });

  it("still maps the reasons the enum does name", () => {
    // The patch replaced only the default branch. A stop must still be a stop
    // and a token limit must still be a length, or the fix would have traded
    // one wrong answer for another.
    const stop: unknown = "STOP";
    const maxTokens: unknown = "MAX_TOKENS";
    const safety: unknown = "SAFETY";
    expect(mapStopReason(stop as Parameters<typeof mapStopReason>[0])).toBe("stop");
    expect(mapStopReason(maxTokens as Parameters<typeof mapStopReason>[0])).toBe("length");
    expect(mapStopReason(safety as Parameters<typeof mapStopReason>[0])).toBe("error");
  });
});
