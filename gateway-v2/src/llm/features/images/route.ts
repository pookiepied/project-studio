import { Hono } from "hono";
import type { Context } from "hono";
import { Capability } from "../../../core/capabilities";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import type { ImageEditRequest, ImageGenerationRequest, MediaResponse } from "../../../core/types";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";
import { getServedCatalog } from "../../discovery/catalog";

export const imagesRoute = new Hono<{ Bindings: GatewayEnv }>();

imagesRoute.post("/generations", async (c) => handleImageGeneration(c));
imagesRoute.post("/generate", async (c) => handleImageGeneration(c));
imagesRoute.post("/edits", async (c) => {
  try {
    const body = await readImageEditRequest(c.req.raw);
    const response = await callImageProvider(c.env, c.req.raw, c.executionCtx, body, Capability.ImageEdit);
    return c.json(toOpenAIImageResponse(response, body.responseFormat ?? body.response_format));
  } catch (error) {
    return toErrorResponse(error);
  }
});

async function handleImageGeneration(c: Context<{ Bindings: GatewayEnv }>) {
  try {
    const body = (await c.req.json()) as Partial<ImageGenerationRequest>;
    if (!body.model || typeof body.model !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
    }
    if (!body.prompt || typeof body.prompt !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include a prompt string.");
    }

    const response = await callImageProvider(
      c.env,
      c.req.raw,
      c.executionCtx,
      { ...body, model: body.model, prompt: body.prompt },
      Capability.ImageGenerate
    );
    return c.json(toOpenAIImageResponse(response, body.responseFormat ?? body.response_format));
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function callImageProvider(
  env: GatewayEnv,
  request: Request,
  executionCtx: unknown,
  body: ImageGenerationRequest | ImageEditRequest,
  capability: Capability
) {
  const catalog = await getServedCatalog(env);
  const model = catalog.models.find(
    (candidate) => candidate.id === body.model || candidate.providerModelId === body.model
  );
  if (!model) {
    throw new GatewayError("MODEL_NOT_FOUND", `Model ${body.model} is not registered with the gateway.`);
  }
  if (!model.capabilities.modalities.includes(capability)) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support ${capability}.`);
  }

  const provider = providers.find((candidate) => candidate.id === model.provider);
  if (!provider?.image) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support images.`);
  }

  return provider.image(
    {
      ...body,
      model: model.providerModelId
    },
    {
      env,
      request,
      executionCtx
    }
  );
}

async function readImageEditRequest(request: Request): Promise<ImageEditRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const model = form.get("model");
    const prompt = form.get("prompt");
    const imageEntries = form.getAll("image");
    const mask = form.get("mask");
    if (typeof model !== "string" || !model) {
      throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a model field.");
    }
    if (typeof prompt !== "string" || !prompt) {
      throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a prompt field.");
    }

    const images = await Promise.all(
      imageEntries.map(async (entry) => {
        if (!(entry instanceof File)) {
          throw new GatewayError("VALIDATION_ERROR", "Image edit requests must include image files.");
        }
        return entry.arrayBuffer();
      })
    );
    if (images.length === 0) {
      throw new GatewayError("VALIDATION_ERROR", "Image edit requests must include at least one image.");
    }

    return {
      model,
      prompt,
      images,
      mask: mask instanceof File ? await mask.arrayBuffer() : undefined,
      n: numberValue(form.get("n")),
      size: stringValue(form.get("size")),
      responseFormat: imageResponseFormat(form.get("response_format")),
      quality: stringValue(form.get("quality")),
      background: stringValue(form.get("background")),
      outputFormat: stringValue(form.get("output_format")),
      outputCompression: numberValue(form.get("output_compression")),
      inputFidelity: imageInputFidelity(form.get("input_fidelity")),
      user: stringValue(form.get("user"))
    };
  }

  const body = (await request.json()) as Partial<ImageEditRequest> & { images?: string[]; mask?: string };
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a prompt string.");
  }
  if (!Array.isArray(body.images) || body.images.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "JSON image edit requests must include base64 images.");
  }

  return {
    ...body,
    model: body.model,
    prompt: body.prompt,
    images: body.images.map(base64ToArrayBuffer),
    mask: typeof body.mask === "string" ? base64ToArrayBuffer(body.mask) : undefined
  };
}

function toOpenAIImageResponse(response: MediaResponse, requestedFormat?: "url" | "b64_json") {
  const items = response.items?.length ? response.items : [response];
  return {
    created: Math.floor(Date.now() / 1000),
    data: items.map((item) => {
      if (requestedFormat === "url" && item.url) {
        return { url: item.url };
      }
      return {
        b64_json: item.base64 ?? (item.bytes ? arrayBufferToBase64(item.bytes) : undefined)
      };
    }),
    usage: response.usage
  };
}

function stringValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function imageResponseFormat(value: FormDataEntryValue | null): "url" | "b64_json" | undefined {
  return value === "url" || value === "b64_json" ? value : undefined;
}

function imageInputFidelity(value: FormDataEntryValue | null): "low" | "high" | undefined {
  return value === "low" || value === "high" ? value : undefined;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
