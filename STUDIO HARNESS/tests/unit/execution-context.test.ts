import { describe, expect, it } from "vitest";

import {
  createChildExecutionContext,
  createRootExecutionContext,
  currentExecutionContext,
  runWithExecutionContext,
} from "../../src/execution/context.js";

describe("execution context", () => {
  it("keeps one request family across child operations", () => {
    const root = createRootExecutionContext({ clientId: "client", sessionId: "session" });
    const tool = createChildExecutionContext(root, { kind: "tool", flue: { toolCallId: "tool-1" } });

    expect(tool.requestId).toBe(root.requestId);
    expect(tool.parentOperationId).toBe(root.operationId);
    expect(tool.kind).toBe("tool");
    expect(tool.flueToolCallId).toBe("tool-1");
  });

  it("propagates through async work without mutable global state", async () => {
    const root = createRootExecutionContext();
    expect(currentExecutionContext()).toBeUndefined();

    await runWithExecutionContext(root, async () => {
      await Promise.resolve();
      expect(currentExecutionContext()).toBe(root);
    });

    expect(currentExecutionContext()).toBeUndefined();
  });

  it("uses a Flue submission as the recovery root when no transport root exists", () => {
    const recovered = createRootExecutionContext({
      requestId: "flue-submission-1",
      requestIdSource: "flue",
      flue: { submissionId: "flue-submission-1", turnId: "turn-1" },
    });

    expect(recovered.requestId).toBe("flue-submission-1");
    expect(recovered.requestIdSource).toBe("flue");
    expect(recovered.flueTurnId).toBe("turn-1");
  });
});
