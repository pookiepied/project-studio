import { Hono } from "hono";
import type { Context } from "hono";
import { Capability } from "../../../core/capabilities";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import type { MediaResponse, VideoGenerationRequest, VideoGenerationResponse } from "../../../core/types";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";
import { getRegistryModel } from "../../../registry";

export const videoRoute = new Hono<{ Bindings: GatewayEnv }>();

// Video generation is pass-through (GATEWAY_GUIDE §2): the AI SDK's
// experimental_generateVideo blocks until the clip is ready and returns the bytes, so the
// gateway returns finished media straight to the caller — it does not store anything.
videoRoute.post("/generations", async (c) => handleVideoGeneration(c));
videoRoute.post("/generate", async (c) => handleVideoGeneration(c));

async function handleVideoGeneration(c: Context<{ Bindings: GatewayEnv }>) {
  try {
    const body = (await c.req.json()) as Partial<VideoGenerationRequest>;
    if (!body.model || typeof body.model !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
    }
    if (body.prompt !== undefined && typeof body.prompt !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "prompt, when provided, must be a string.");
    }
    if (body.image !== undefined && typeof body.image !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "image, when provided, must be a base64/data-URL/URL string.");
    }
    // Text-to-video needs a prompt; image-to-video needs an image (text optional). Require at least one.
    if (!body.prompt && !body.image) {
      throw new GatewayError("VALIDATION_ERROR", "Request must include a prompt (text-to-video) or an image (image-to-video).");
    }

    const model = getRegistryModel(body.model);
    if (!model) {
      throw new GatewayError("MODEL_NOT_FOUND", `Model ${body.model} is not registered with the gateway.`);
    }
    if (!model.capabilities.modalities.includes(Capability.VideoGenerate)) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support video generation.`);
    }

    const provider = providers.find((candidate) => candidate.id === model.provider);
    if (!provider?.video) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support video generation.`);
    }

    const response = await provider.video(
      { ...body, model: model.providerModelId, prompt: body.prompt },
      {
        env: c.env,
        request: c.req.raw,
        executionCtx: c.executionCtx
      }
    );

    return c.json(toVideoResponse(response));
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toVideoResponse(response: VideoGenerationResponse) {
  if (response.jobId && !response.media) {
    return { created: nowSeconds(), status: "processing", jobId: response.jobId };
  }

  const media = response.media ?? {};
  const items = media.items?.length ? media.items : [media];
  return {
    created: nowSeconds(),
    data: items.map((item: MediaResponse) => {
      if (item.url) {
        return { url: item.url, media_type: item.mediaType };
      }
      return {
        b64_json: item.base64 ?? (item.bytes ? arrayBufferToBase64(item.bytes) : undefined),
        media_type: item.mediaType
      };
    }),
    usage: media.usage
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
