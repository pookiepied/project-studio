
import { describe, it, expect } from "vitest";
import { mapModelsDevToDefinition } from "../src/catalog/mapper.ts";

describe("catalog mapping expanded", () => {
  it("maps image model", () => {
    const m = mapModelsDevToDefinition("fal", "flux-pro", {
      name: "Flux Pro", description: "img", family: "flux", modalities: { input: ["text"], output: ["image"] },
      limit: { context: 1000, output: 100 }, tool_call: false, reasoning: false, open_weights: false, knowledge: "2024-01", release_date: "2024-01-01",
    } as never);
    expect(m.category).toBe("image");
  });
  it("maps transcription", () => {
    const m = mapModelsDevToDefinition("openai", "whisper-1", {
      name: "Whisper", modalities: { input: ["audio"], output: ["text"] },
      limit: { context: 1000, output: 100 }, tool_call: false, reasoning: false, release_date: "2024-01-01",
    } as never);
    expect(m.category).toBe("transcription");
  });
});
