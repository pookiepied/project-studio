import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

/**
 * The harness does not own a retry policy of its own. A patch on
 * @flue/runtime (patches/@flue__runtime@1.0.0-beta.9) replaces the runtime's
 * inline transient-error regex with a delegation to this function — so these
 * verdicts ARE the harness's verdicts, and this file pins the ones the patch
 * was written for. If pi-ai changes any of them, the behaviour changes with
 * it; the point here is that such a change happens deliberately and visibly,
 * not silently inside a semver range.
 *
 * The two properties that motivated the delegation: quota and billing
 * exhaustion is checked BEFORE the transient patterns (OpenAI reports
 * insufficient_quota as HTTP 429, so a sentence can match both lists, and
 * non-retryable must win), and the retryable list recognizes OpenRouter's
 * "Provider returned error" wrapper, which the runtime's own regex did not.
 */
function refusedWith(errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "project-studio-test",
    provider: "project-studio-test",
    model: "default",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
    timestamp: 0,
  };
}

describe("the classifier behind the patched retry decision", () => {
  it("refuses to retry the real OpenAI billing shape, even though it says 429", () => {
    expect(
      isRetryableAssistantError(
        refusedWith(
          "You exceeded your current quota, please check your plan and billing details (insufficient_quota). (HTTP 429)",
        ),
      ),
    ).toBe(false);
  });

  it("retries OpenRouter's wrapper wording that the old inline regex missed", () => {
    expect(isRetryableAssistantError(refusedWith("Provider returned error"))).toBe(true);
  });

  it("retries the plain rate-limit sentence", () => {
    expect(
      isRetryableAssistantError(
        refusedWith("429 rate limit exceeded: temporarily rate-limited upstream"),
      ),
    ).toBe(true);
  });

  it("retries premature stream endings and gRPC exhaustion wordings", () => {
    expect(isRetryableAssistantError(refusedWith("stream ended before message_stop"))).toBe(true);
    expect(isRetryableAssistantError(refusedWith("ResourceExhausted"))).toBe(true);
  });

  it("does not retry an empty sentence or a sentence matching nothing", () => {
    expect(isRetryableAssistantError(refusedWith(""))).toBe(false);
    expect(
      isRetryableAssistantError(refusedWith("The upstream planet is misaligned")),
    ).toBe(false);
  });

  it("ignores messages whose stop reason is not an error", () => {
    const completed = refusedWith("429 rate limit exceeded");
    const { errorMessage: _errorMessage, ...finished } = {
      ...completed,
      stopReason: "stop" as const,
    };
    expect(isRetryableAssistantError(finished)).toBe(false);
  });
});
