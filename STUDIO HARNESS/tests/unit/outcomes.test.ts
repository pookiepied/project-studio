import { describe, expect, it } from "vitest";

import { outcomeFor } from "../../src/execution/outcomes.js";

describe("stop/timeout/cancellation outcomes", () => {
  it("maps every reason to one stable outcome", () => {
    expect(outcomeFor("user_stop", true).outcome).toBe("aborted");
    expect(outcomeFor("user_stop", false).outcome).toBe("aborted");
    expect(outcomeFor("deadline", true).outcome).toBe("failed");
    expect(outcomeFor("transport_loss", true).outcome).toBe("unknown");
    expect(outcomeFor("child_exit", true).outcome).toBe("failed");
    expect(outcomeFor("provider_failure", true).outcome).toBe("failed");
  });

  // `idempotent` was accepted and never read, so this decision was not being
  // made at all: a non-idempotent capability and an idempotent one got the
  // same answer. Fails if the parameter is ignored again.
  it("decides retry safety for unknown from idempotence", () => {
    expect(outcomeFor("transport_loss", false).retryable).toBe(false);
    expect(outcomeFor("transport_loss", true).retryable).toBe(true);
  });

  it("does not let idempotence make a settled outcome retryable", () => {
    expect(outcomeFor("user_stop", true).retryable).toBe(false);
    expect(outcomeFor("deadline", true).retryable).toBe(false);
    expect(outcomeFor("child_exit", true).retryable).toBe(false);
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
