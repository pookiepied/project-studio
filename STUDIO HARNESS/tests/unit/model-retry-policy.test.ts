import { describe, expect, it } from "vitest";

import { isRetryableAssistantError } from "@earendil-works/pi-ai";

import type { AssistantMessage } from "@earendil-works/pi-ai";

import {
  classifyTransientRetryClass,
  clearInstalledTransientModelRetryPolicy,
  createStudioTransientModelRetryPolicy,
  installTransientModelRetryPolicy,
  TRANSIENT_MODEL_RETRY_POLICY_KEY,
} from "../../src/reliability/model-retry-policy.js";

function errored(errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "project-studio-test",
    provider: "project-studio",
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

describe("transient model retry policy", () => {
  describe("classification", () => {
    it("reads throttling as rate-limit", () => {
      expect(classifyTransientRetryClass("429")).toBe("rate-limit");
      expect(
        classifyTransientRetryClass(
          "429 rate limit exceeded: temporarily rate-limited upstream",
        ),
      ).toBe("rate-limit");
      expect(classifyTransientRetryClass("HTTP 429")).toBe("rate-limit");
      expect(classifyTransientRetryClass("Too many requests")).toBe(
        "rate-limit",
      );
    });

    it("reads dead connections as transport", () => {
      expect(classifyTransientRetryClass("socket hang up")).toBe("transport");
      expect(classifyTransientRetryClass("connection reset by peer")).toBe(
        "transport",
      );
      expect(classifyTransientRetryClass("fetch failed")).toBe("transport");
      expect(classifyTransientRetryClass("stream ended before message_stop")).toBe(
        "transport",
      );
      expect(classifyTransientRetryClass("websocket closed")).toBe("transport");
      expect(classifyTransientRetryClass("Request timed out")).toBe(
        "transport",
      );
    });

    it("reads server trouble and everything unnameable as generic-transient", () => {
      expect(classifyTransientRetryClass("503 service unavailable")).toBe(
        "generic-transient",
      );
      expect(classifyTransientRetryClass("Provider returned error")).toBe(
        "generic-transient",
      );
      expect(classifyTransientRetryClass("overloaded")).toBe(
        "generic-transient",
      );
      expect(classifyTransientRetryClass("ResourceExhausted")).toBe(
        "generic-transient",
      );
      // A sentence matching nothing at all: pi-ai has already refused to call
      // this retryable before classification runs, so the class only has to
      // be total, not clairvoyant.
      expect(classifyTransientRetryClass(undefined)).toBe(
        "generic-transient",
      );
      expect(classifyTransientRetryClass("")).toBe("generic-transient");
    });

    it("lets the status win when transport noise shares the sentence", () => {
      // The 429 is what the provider said on purpose; the connection words
      // are the wrapper's accident. Generosity follows the deliberate part.
      expect(
        classifyTransientRetryClass("connection dropped during HTTP 429"),
      ).toBe("rate-limit");
    });
  });

  describe("composition with pi-ai's classifier", () => {
    // The policy only ever sees sentences that passed
    // `isRetryableAssistantError`. These pin that boundary from both sides:
    // if an upgrade moves a wording across it, this fails here rather than
    // silently changing who owns the zero-budget row.
    const neverRetried = [
      "You exceeded your current quota, please check your plan and billing details (insufficient_quota)",
      "You exceeded your current quota, please check your plan and billing details (insufficient_quota). (HTTP 429)",
      "Out of budget.",
      "Monthly usage limit reached",
    ];
    const retried = [
      "429 rate limit exceeded: temporarily rate-limited upstream",
      "503 service unavailable",
      "socket hang up",
      "Provider returned error",
    ];

    it("never sees the quota and billing exhaustion pi-ai refuses to retry", () => {
      for (const sentence of neverRetried) {
        expect(isRetryableAssistantError(errored(sentence))).toBe(false);
      }
    });

    it("sees exactly the transient sentences pi-ai calls retryable", () => {
      for (const sentence of retried) {
        expect(isRetryableAssistantError(errored(sentence))).toBe(true);
      }
    });
  });

  describe("budgets", () => {
    const policy = createStudioTransientModelRetryPolicy();

    it("grants the generous budget to throttling", () => {
      expect(
        policy.decideTransientModelRetry({
          attempt: 1,
          error: "429 rate limit exceeded",
        }).maxRetries,
      ).toBe(8);
    });

    it("keeps yesterday's budget for the unnamed bucket", () => {
      expect(
        policy.decideTransientModelRetry({
          attempt: 1,
          error: "503 service unavailable",
        }).maxRetries,
      ).toBe(3);
    });

    it("fails fast on dead connections", () => {
      expect(
        policy.decideTransientModelRetry({
          attempt: 1,
          error: "socket hang up",
        }).maxRetries,
      ).toBe(2);
    });

    it("maps the give-up boundary onto the bundle's one-based attempts", () => {
      // The bundle gives up once `attempt` exceeds the budget; the shared
      // mechanism counts from zero. Under that mapping the last allowed
      // attempt still earns a delay, and the first over it earns none.
      const rateLimit = policy.decideTransientModelRetry({
        attempt: 8,
        error: "429 too many requests",
      });
      expect(rateLimit.maxRetries).toBe(8);
      const exhausted = policy.decideTransientModelRetry({
        attempt: 9,
        error: "429 too many requests",
      });
      expect(exhausted.maxRetries).toBe(8);
      expect(exhausted.delayMs).toBe(0);
      const transportEdge = policy.decideTransientModelRetry({
        attempt: 3,
        error: "socket hang up",
      });
      expect(transportEdge.delayMs).toBe(0);
    });
  });

  describe("delays", () => {
    it("doubles from the shipped base under an injected random", () => {
      const policy = createStudioTransientModelRetryPolicy({ random: () => 1 });
      // Ceiling for attempt n is 2000 * 2^(n-1) until the 30s cap.
      expect(
        policy.decideTransientModelRetry({
          attempt: 1,
          error: "503 service unavailable",
        }),
      ).toEqual({ maxRetries: 3, delayMs: 2_000 });
      expect(
        policy.decideTransientModelRetry({
          attempt: 3,
          error: "503 service unavailable",
        }),
      ).toEqual({ maxRetries: 3, delayMs: 8_000 });
    });

    it("caps any single wait at thirty seconds even late in a generous run", () => {
      const policy = createStudioTransientModelRetryPolicy({ random: () => 1 });
      // Attempt 6 would be 2000 * 2^5 = 64s uncapped; the shared ceiling holds.
      expect(
        policy.decideTransientModelRetry({
          attempt: 6,
          error: "429 rate limit exceeded",
        }).delayMs,
      ).toBe(30_000);
    });

    it("jitters top-heavy by default so each announced wait stays near its ceiling", () => {
      // The default source draws from [0.75, 1.0): every wait lands in the
      // top quarter of its attempt's doubling — which, while the doublings
      // still grow, keeps a later attempt's ANNOUNCED wait above an earlier
      // one's. A countdown that shrinks mid-failure reads as chaos.
      const policy = createStudioTransientModelRetryPolicy();
      for (const attempt of [1, 2, 3]) {
        const grant = policy.decideTransientModelRetry({
          attempt,
          error: "503 service unavailable",
        });
        const ceiling = 2_000 * 2 ** (attempt - 1);
        expect(grant.delayMs).toBeGreaterThanOrEqual(ceiling * 0.75);
        expect(grant.delayMs).toBeLessThanOrEqual(ceiling);
      }
    });
  });

  describe("class changes between attempts", () => {
    it("follows the newest failure without remembering the previous one", () => {
      const policy = createStudioTransientModelRetryPolicy();
      // A turn that fails with a 503 and then a 429: the second decision
      // carries the generous budget, because the failure actually in front
      // of the loop is throttling. Nothing was stored between the calls.
      const afterServerFailure = policy.decideTransientModelRetry({
        attempt: 1,
        error: "503 service unavailable",
      });
      expect(afterServerFailure.maxRetries).toBe(3);
      const afterThrottle = policy.decideTransientModelRetry({
        attempt: 2,
        error: "429 too many requests",
      });
      expect(afterThrottle.maxRetries).toBe(8);
      // And the reverse ordering reads the same way, which is what makes the
      // count re-derivable from persisted records alone after a resume.
      const reversedFirst = policy.decideTransientModelRetry({
        attempt: 1,
        error: "429 too many requests",
      });
      expect(reversedFirst.maxRetries).toBe(8);
      const reversedSecond = policy.decideTransientModelRetry({
        attempt: 2,
        error: "503 service unavailable",
      });
      expect(reversedSecond.maxRetries).toBe(3);
    });
  });

  describe("installation", () => {
    it("publishes the latest installation and clears to absence", () => {
      const first = createStudioTransientModelRetryPolicy();
      const second = createStudioTransientModelRetryPolicy();
      installTransientModelRetryPolicy(first);
      expect(
        globalThis[TRANSIENT_MODEL_RETRY_POLICY_KEY],
      ).toBe(first);
      installTransientModelRetryPolicy(second);
      expect(
        globalThis[TRANSIENT_MODEL_RETRY_POLICY_KEY],
      ).toBe(second);
      clearInstalledTransientModelRetryPolicy();
      expect(globalThis[TRANSIENT_MODEL_RETRY_POLICY_KEY]).toBeUndefined();
    });
  });
});
