import { describe, expect, it } from "vitest";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, Model } from "@earendil-works/pi-ai";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { PiCredentialStore } from "../../src/gateway/language/local/credential-bridge.js";
import { createLocalRuntime, quietThinkingLevelForPiModel } from "../../src/gateway/language/local/runtime.js";
import { languageCatalogModels } from "../../src/gateway/language/pi-catalog.js";
import { runThinkingLevelForChoice } from "../../src/contracts/models.js";

/**
 * Task 60: what reaches the wire for a resting turn.
 *
 * Every turn sent to a reasoning model now carries an explicit level (medium
 * when the model supports it). A model that does not reason keeps sending no
 * reasoning parameter. The payloads below are captured through Pi's own
 * `onPayload` seam, which sees the exact params before any network, so no
 * mock server or credential is needed; the callback aborts the request after
 * capturing.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function capturePayload(
  model: Model<Api>,
  options: Record<string, unknown>,
): Promise<unknown> {
  const credentials = new PiCredentialStore(new InMemoryCredentialStore());
  const models = builtinModels({ credentials });
  // The collection owns the provider routing; the live model record is read
  // from it so the thinkingLevelMap (including the OpenRouter off=null fix
  // when applied through the local runtime) is the one the request uses.
  const live = models.getModel(model.provider, model.id) ?? model;
  let captured: unknown;
  const stream = models.streamSimple(
    live,
    { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
    {
      apiKey: "test-key",
      ...options,
      onPayload: (params: unknown) => {
        captured = params;
        throw new Error("capture-only");
      },
    },
  );
  try {
    for await (const _event of stream) {
      // Drained to let the provider reach onPayload; the capture aborts it.
    }
  } catch {
    // The capture aborts the request by design.
  }
  return captured;
}

function firstReasoningModel(provider: string, api?: string): Model<Api> | undefined {
  const candidates = languageCatalogModels(provider).filter(
    (model) => model.reasoning && (api === undefined || model.api === api),
  );
  return candidates[0];
}

function firstMuteModel(provider: string): Model<Api> | undefined {
  const candidates = languageCatalogModels(provider).filter((model) => !model.reasoning);
  return candidates[0];
}

describe("a resting turn on the wire", () => {
  it("carries an explicit reasoning_effort on an OpenAI-family model", async () => {
    const model =
      firstReasoningModel("openai", "openai-completions") ?? firstReasoningModel("openai");
    if (model === undefined) throw new Error("No reasoning OpenAI model in the catalog.");
    const resting = runThinkingLevelForChoice("default", ["minimal", "low", "medium", "high"]);
    expect(resting).toBe("medium");
    const payload = await capturePayload(model, { reasoning: resting });
    if (!isRecord(payload)) throw new Error("OpenAI payload was not a record.");
    const direct = payload["reasoning_effort"];
    if (typeof direct === "string") {
      expect(direct).toBe("medium");
      return;
    }
    const nested = payload["reasoning"];
    if (!isRecord(nested)) throw new Error("OpenAI payload carried no reasoning effort.");
    expect(nested["effort"]).toBe("medium");
  });

  it("carries enabled thinking on an Anthropic model", async () => {
    const model = firstReasoningModel("anthropic");
    if (model === undefined) throw new Error("No reasoning Anthropic model in the catalog.");
    const resting = runThinkingLevelForChoice("default", ["minimal", "low", "medium", "high"]);
    const payload = await capturePayload(model, { reasoning: resting });
    if (!isRecord(payload)) throw new Error("Anthropic payload was not a record.");
    const thinking = payload["thinking"];
    if (!isRecord(thinking)) throw new Error("Anthropic payload carried no thinking object.");
    const kind = thinking["type"];
    // Budget-based models send enabled, adaptive models send adaptive; both
    // are the enabled branch that thinkingEnabled true selects, never disabled.
    expect(kind === "enabled" || kind === "adaptive").toBe(true);
  });

  it("carries a real thinkingConfig with includeThoughts on Google, not thinkingBudget 0", async () => {
    const model = firstReasoningModel("google");
    if (model === undefined) throw new Error("No reasoning Google model in the catalog.");
    const resting = runThinkingLevelForChoice("default", ["minimal", "low", "medium", "high"]);
    const payload = await capturePayload(model, { reasoning: resting });
    if (!isRecord(payload)) throw new Error("Google payload was not a record.");
    const config = payload["config"];
    if (!isRecord(config)) throw new Error("Google payload carried no config.");
    const thinkingConfig = config["thinkingConfig"];
    if (!isRecord(thinkingConfig)) throw new Error("Google payload carried no thinkingConfig.");
    expect(thinkingConfig["includeThoughts"]).toBe(true);
    expect(thinkingConfig["thinkingBudget"]).not.toBe(0);
  });

  it("sends no reasoning parameter for a model that does not reason", async () => {
    const model = firstMuteModel("openai") ?? firstMuteModel("anthropic");
    if (model === undefined) throw new Error("No non-reasoning model in the catalog.");
    const resting = runThinkingLevelForChoice("default", []);
    expect(resting).toBe("off");
    // No reasoning option at all is what the agent loop sends for "off".
    const payload = await capturePayload(model, {});
    if (!isRecord(payload)) throw new Error("Mute payload was not a record.");
    expect(payload["reasoning_effort"]).toBeUndefined();
    const thinking = payload["thinking"];
    // Anthropic's disabled shape is also absence of enabled thinking; an
    // explicit disabled object is still not a request to think.
    if (isRecord(thinking)) {
      expect(thinking["type"]).not.toBe("enabled");
    }
  });
});

describe("the synchronous supported-levels lookup", () => {
  it("answers a known reasoning reference with its levels", () => {
    const credentials = new PiCredentialStore(new InMemoryCredentialStore());
    const runtime = createLocalRuntime({
      config: {
        defaultProvider: undefined,
        defaultModel: undefined,
        customProviders: [],
        extraModels: [],
      },
      credentials,
    });
    const model = firstReasoningModel("openai");
    if (model === undefined) throw new Error("No reasoning OpenAI model in the catalog.");
    const reference = `${model.provider}/${model.id}`;
    const levels = runtime.supportedReasoningLevels(reference);
    expect(levels).toContain("medium");
  });

  it("answers a known mute reference with empty", () => {
    const credentials = new PiCredentialStore(new InMemoryCredentialStore());
    const runtime = createLocalRuntime({
      config: {
        defaultProvider: undefined,
        defaultModel: undefined,
        customProviders: [],
        extraModels: [],
      },
      credentials,
    });
    const model = firstMuteModel("openai");
    if (model === undefined) throw new Error("No mute OpenAI model in the catalog.");
    const reference = `${model.provider}/${model.id}`;
    expect(runtime.supportedReasoningLevels(reference)).toEqual([]);
  });

  it("answers an unknown reference with medium to stay on the explicit path", () => {
    const credentials = new PiCredentialStore(new InMemoryCredentialStore());
    const runtime = createLocalRuntime({
      config: {
        defaultProvider: undefined,
        defaultModel: undefined,
        customProviders: [],
        extraModels: [],
      },
      credentials,
    });
    expect(runtime.supportedReasoningLevels("openai/no-such-model")).toEqual(["medium"]);
  });

  it("answers the alias with medium when no default model is configured", () => {
    // The alias resolves to nothing here, and it resolves to nothing again
    // when a configured default names a model that has since been removed.
    // Both are an unknown reference. Answering empty would say "this model
    // does not reason" and send the silence this task removed.
    const credentials = new PiCredentialStore(new InMemoryCredentialStore());
    const runtime = createLocalRuntime({
      config: {
        defaultProvider: undefined,
        defaultModel: undefined,
        customProviders: [],
        extraModels: [],
      },
      credentials,
    });
    expect(runtime.supportedReasoningLevels(null)).toEqual(["medium"]);
  });

  it("answers the alias with medium when the configured default has gone", () => {
    const credentials = new PiCredentialStore(new InMemoryCredentialStore());
    const runtime = createLocalRuntime({
      config: {
        defaultProvider: "openai",
        defaultModel: "no-such-model",
        customProviders: [],
        extraModels: [],
      },
      credentials,
    });
    expect(runtime.supportedReasoningLevels(null)).toEqual(["medium"]);
  });
});

describe("the quietest thinking a spoken reply can ask for", () => {
  /** Every effort the payload names: its output config and any managed-effort system messages. */
  function efforts(payload: unknown): string[] {
    if (!isRecord(payload)) return [];
    const found: string[] = [];
    const config = payload["output_config"];
    if (isRecord(config) && typeof config["effort"] === "string") found.push(config["effort"]);
    const messages = Array.isArray(payload["messages"]) ? payload["messages"] : [];
    for (const message of messages) {
      const inner = isRecord(message) ? message["output_config"] : undefined;
      if (isRecord(inner) && typeof inner["effort"] === "string") found.push(inner["effort"]);
    }
    return found;
  }

  it("lowers a managed-effort Claude model below the high effort that off sends", async () => {
    const model = languageCatalogModels("anthropic").find(
      (candidate) => (candidate as { compat?: { supportsMidConvoEffort?: boolean } }).compat?.supportsMidConvoEffort === true,
    );
    if (model === undefined) throw new Error("No managed-effort Anthropic model in the catalog.");
    const quiet = quietThinkingLevelForPiModel(model);
    expect(quiet).not.toBe("off");
    // "off" is not off on this wire: the effort the voice turn used to carry.
    expect(efforts(await capturePayload(model, {}))).toContain("high");
    expect(efforts(await capturePayload(model, { reasoning: quiet }))).toContain("low");
  });

  it("stays off for a model that honours off", () => {
    const model = firstReasoningModel("openai");
    if (model === undefined) throw new Error("No reasoning OpenAI model in the catalog.");
    expect(quietThinkingLevelForPiModel(model)).toBe("off");
  });
});
