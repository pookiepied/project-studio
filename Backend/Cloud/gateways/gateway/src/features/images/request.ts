import type { ImageEditRequest, ImageGenerationRequest } from "@/domain/contracts";
import { decodeBase64 } from "@/platform/encoding/base64";
import { GatewayError } from "@/platform/errors";

export async function parseImageGenerationRequest(request: Request): Promise<ImageGenerationRequest> {
  const body = (await request.json()) as Partial<ImageGenerationRequest>;
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a prompt string.");
  }
  return { ...body, model: body.model, prompt: body.prompt };
}

export async function parseImageEditRequest(request: Request): Promise<ImageEditRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartImageEdit(await request.formData());
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
    images: body.images.map(decodeBase64),
    mask: typeof body.mask === "string" ? decodeBase64(body.mask) : undefined
  };
}

async function parseMultipartImageEdit(form: FormData): Promise<ImageEditRequest> {
  const model = form.get("model");
  const prompt = form.get("prompt");
  if (typeof model !== "string" || !model) {
    throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a model field.");
  }
  if (typeof prompt !== "string" || !prompt) {
    throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a prompt field.");
  }

  const images = await Promise.all(
    form.getAll("image").map(async (entry) => {
      if (!(entry instanceof File)) {
        throw new GatewayError("VALIDATION_ERROR", "Image edit requests must include image files.");
      }
      return entry.arrayBuffer();
    })
  );
  if (images.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "Image edit requests must include at least one image.");
  }

  const mask = form.get("mask");
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
