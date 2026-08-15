import { describe, expect, it } from "vitest";

import { isRetryableForUnknown, outcomeFor } from "../../src/execution/outcomes.js";

describe("stop/timeout/cancellation outcomes", () => {
  it("maps every reason to one stable outcome", () => {
    expect(outcomeFor("user_stop", true).outcome).toBe("aborted");
    expect(outcomeFor("user_stop", false).outcome).toBe("aborted");
    expect(outcomeFor("deadline", true).outcome).toBe("failed");
    expect(outcomeFor("transport_loss", true).outcome).toBe("unknown");
    expect(outcomeFor("child_exit", true).outcome).toBe("failed");
    expect(outcomeFor("provider_failure", true).outcome).toBe("failed");
  });

  it("does not retry unknown for non-idempotent, allows retry for idempotent", () => {
    expect(isRetryableForUnknown(false, "unknown")).toBe(false);
    expect(isRetryableForUnknown(true, "unknown")).toBe(true);
    expect(isRetryableForUnknown(true, "completed")).toBe(false);
    expect(isRetryableForUnknown(true, "aborted")).toBe(false);
    expect(isRetryableForUnknown(true, "failed")).toBe(false);
  });

  it("keeps transport loss as unknown, not aborted — desktop disconnect does not cancel", () => {
    const outcome = outcomeFor("transport_loss", false);
    expect(outcome.outcome).toBe("unknown");
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).toMatch(/continues/i);
  });

  it("keeps provider failure retryable, user stop not", () => {
    expect(outcomeFor("provider_failure", true).retryable).toBe(true);
    expect(outcomeFor("user_stop", true).retryable).toBe(false);
  });
});
