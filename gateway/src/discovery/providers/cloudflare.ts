/**
 * Cloudflare Workers AI Provider Discovery
 *
 * Cloudflare runs AI inference natively in the Worker runtime via the `env.AI`
 * binding. There is no public /models list endpoint, so the catalogue below is
 * maintained statically.
 *
 * Model IDs follow the pattern `cloudflare:<friendly-name>`, which maps to the
 * full CF AI path (e.g. `@cf/black-forest-labs/flux-1-schnell`) inside the
 * image generation router in imageGenerate.ts.
 *
 * ── Why include Cloudflare in discovery? ────────────────────────────────────
 *   These models appear in MODELS_KV alongside all other providers. The frontend
 *   image model selector will show them so users can pick FLUX Schnell as their
 *   image generation model without needing an OpenRouter key.
 *
 * Pricing: based on Cloudflare Workers AI pricing as of May 2026.
 *   Image generation is billed per step (neuron-second). Approximate costs:
 *     flux-1-schnell      — ~$0.0004/image at 4 steps
 *     stable-diffusion-xl — ~$0.0005/image
 *   https://developers.cloudflare.com/workers-ai/platform/pricing/
 *
 * ── Adding new models ────────────────────────────────────────────────────────
 *   1. Add a new entry to CLOUDFLARE_IMAGE_MODELS below.
 *   2. Add the friendly-name → @cf/... mapping to CF_MODEL_MAP in imageGenerate.ts.
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Static model catalogue
// ─────────────────────────────────────────────────────────────────────────────

const CLOUDFLARE_IMAGE_MODELS: Model[] = [
  {
    id:       "cloudflare:flux-1-schnell",
    provider: "cloudflare",
    type:     "image",
    name:     "FLUX.1 Schnell",
    description:
      "Black Forest Labs FLUX.1 Schnell — ultra-fast text-to-image, 4 inference steps. " +
      "Best for quick drafts and iteration. Runs natively on Cloudflare's edge.",
    pricing:  { input: 0.0004, output: 0, currency: "USD" }, // per generation
    free:     false,
    capabilities:    ["image-generation", "text-to-image"],
    modality:        ["text", "image"],
    architecture:    "FLUX",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:       "cloudflare:stable-diffusion-xl",
    provider: "cloudflare",
    type:     "image",
    name:     "Stable Diffusion XL",
    description:
      "Stability AI SDXL 1.0 — high-quality text-to-image generation. " +
      "Runs natively on Cloudflare's edge infrastructure.",
    pricing:  { input: 0.0005, output: 0, currency: "USD" },
    free:     false,
    capabilities:    ["image-generation", "text-to-image"],
    modality:        ["text", "image"],
    architecture:    "Stable Diffusion",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:       "cloudflare:sd-xl-lightning",
    provider: "cloudflare",
    type:     "image",
    name:     "SD-XL Lightning",
    description:
      "ByteDance Stable Diffusion XL Lightning — distilled for fast inference. " +
      "Low-latency alternative to full SDXL. Runs natively on Cloudflare.",
    pricing:  { input: 0.0003, output: 0, currency: "USD" },
    free:     false,
    capabilities:    ["image-generation", "text-to-image"],
    modality:        ["text", "image"],
    architecture:    "Stable Diffusion",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:       "cloudflare:dreamshaper-8",
    provider: "cloudflare",
    type:     "image",
    name:     "DreamShaper 8",
    description:
      "Lykon DreamShaper 8 LCM — artistic / fantasy-style image generation. " +
      "Good for creative, painterly, and surreal imagery. Runs on Cloudflare edge.",
    pricing:  { input: 0.0003, output: 0, currency: "USD" },
    free:     false,
    capabilities:    ["image-generation", "text-to-image"],
    modality:        ["text", "image"],
    architecture:    "Stable Diffusion",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class CloudflareDiscovery implements ProviderDiscovery {
  name = "cloudflare";

  /**
   * @param hasAiBinding  Pass `true` when `env.AI` is bound (i.e. wrangler.toml
   *                      has `[ai]`). Pass `false` to skip returning models so
   *                      the frontend doesn't offer CF AI when it isn't configured.
   */
  constructor(private readonly hasAiBinding: boolean) {}

  async discoverModels(): Promise<Model[]> {
    if (!this.hasAiBinding) {
      logger.info("cloudflare: AI binding not present — skipping");
      return [];
    }
    logger.info(`cloudflare: ${CLOUDFLARE_IMAGE_MODELS.length} models (static)`);
    return CLOUDFLARE_IMAGE_MODELS;
  }
}
