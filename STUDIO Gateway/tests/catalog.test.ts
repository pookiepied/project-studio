import { describe, expect, it } from "vitest";
import { mapModelsDevToDefinition } from "../src/catalog/mapper.ts";

describe("models.dev mapping", () => {
  it("preserves catalog metadata and identifies embedding fallbacks", () => {
    const model = mapModelsDevToDefinition("openai", "text-embedding-3-small", {
      name: "Text Embedding 3 Small",
      description: "Embedding model",
      family: "embedding",
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 8192, output: 1 },
      cost: { input: 0.02, output: 0 },
      tool_call: false,
      reasoning: false,
      open_weights: false,
      knowledge: "2024-06",
      release_date: "2024-01-01",
    });

    expect(model.category).toBe("embedding");
    expect(model.family).toBe("embedding");
    expect(model.knowledgeCutoff).toBe("2024-06");
    expect(model.catalogSource).toBe("models.dev");
    expect(model.supportsParallelTools).toBe(false);
  });
});
