import { describe, expect, it } from "vitest";

import { PassthroughContextOptimizer } from "../../src/context/context-optimizer.js";
import { ModelRegistry } from "../../src/models/model-registry.js";

describe("harness boundaries", () => {
  it("resolves model references without embedding gateway details in agents", () => {
    const registry = new ModelRegistry();
    registry.register(
      "local",
      ({ provider, model }) => `local-${provider}/${model}`,
    );

    expect(
      registry.resolve({
        source: "local",
        provider: "openai",
        model: "example",
      }),
    ).toBe("local-openai/example");
  });

  it("keeps canonical context available when optimization is disabled", async () => {
    const optimizer = new PassthroughContextOptimizer();
    const context = { messages: [{ role: "user", content: "hello" }] };

    const result = await optimizer.optimize(context);

    expect(result.optimizer).toBe("passthrough");
    expect(result.canonical).toBe(context);
    expect(result.optimized).toBe(context);
  });
});
