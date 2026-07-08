/**
 * fal.ai Provider Discovery — static model catalogue
 *
 * fal.ai does not expose a public /models list endpoint, so the catalogue
 * below is manually curated and updated when notable new models ship.
 *
 * Model IDs use the format `fal:{fal-model-path}` in MODELS_KV.
 * The generation tools strip the `fal:` prefix before calling fal.ai.
 *
 * Docs:     https://fal.ai/models
 * API keys: https://fal.ai/dashboard/keys
 *
 * ── Pricing notes ──────────────────────────────────────────────────────────
 * Prices below are approximate as of 2026 and subject to change.
 * Image: per image generated.
 * Video: per second of output.
 * Check https://fal.ai/pricing for current rates.
 *
 * ── Adding new models ───────────────────────────────────────────────────────
 * 1. Find the model slug on https://fal.ai/models
 * 2. Add an entry to FAL_IMAGE_MODELS or FAL_VIDEO_MODELS below.
 * 3. For video models with image-to-video variants, update IMG2VID_MAP
 *    in videoGenerate.ts so the tool auto-switches when source_image is given.
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Image models
// ─────────────────────────────────────────────────────────────────────────────

const FAL_IMAGE_MODELS: Model[] = [
  {
    id:          "fal:fal-ai/flux-pro/v1.1",
    provider:    "fal",
    type:        "image",
    name:        "FLUX.1 Pro v1.1",
    description: "Black Forest Labs FLUX.1 Pro — flagship quality, photorealism, accurate prompt following. Best all-around image model.",
    pricing:     { input: 0.04, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "FLUX",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/flux-pro/v1.1-ultra",
    provider:    "fal",
    type:        "image",
    name:        "FLUX.1 Pro Ultra",
    description: "Black Forest Labs FLUX.1 Pro Ultra — highest quality, up to 2K resolution. Best for professional and print-quality output.",
    pricing:     { input: 0.06, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "FLUX",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/flux/dev",
    provider:    "fal",
    type:        "image",
    name:        "FLUX.1 Dev",
    description: "Black Forest Labs FLUX.1 Dev — fast, open-weight model with great quality. Good balance of speed and quality.",
    pricing:     { input: 0.025, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "FLUX",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/ideogram/v2",
    provider:    "fal",
    type:        "image",
    name:        "Ideogram v2",
    description: "Ideogram v2 — best model for text rendering inside images. Logos, posters, cards with legible typography. Also great for photorealism.",
    pricing:     { input: 0.08, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "Ideogram",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/recraft-v3",
    provider:    "fal",
    type:        "image",
    name:        "Recraft V3",
    description: "Recraft V3 — best for brand design, icons, SVG-style graphics, and consistent stylized art. Supports custom style reference.",
    pricing:     { input: 0.04, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "Recraft",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/stable-diffusion-v35-large",
    provider:    "fal",
    type:        "image",
    name:        "Stable Diffusion 3.5 Large",
    description: "Stability AI SD 3.5 Large — flagship Stable Diffusion model. Strong on artistic and creative styles.",
    pricing:     { input: 0.035, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "Stable Diffusion",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
  {
    id:          "fal:fal-ai/aura-flow",
    provider:    "fal",
    type:        "image",
    name:        "AuraFlow",
    description: "AuraFlow — fast, high-quality open model. Great for artistic, painterly, and fantasy styles at a lower cost.",
    pricing:     { input: 0.013, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["image-generation", "text-to-image"],
    modality:         ["text", "image"],
    architecture:     "AuraFlow",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["image"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Video models  (text-to-video only shown in picker — image-to-video variants
// are auto-selected by videoGenerate.ts when source_image is provided)
// ─────────────────────────────────────────────────────────────────────────────

const FAL_VIDEO_MODELS: Model[] = [
  {
    id:          "fal:fal-ai/kling-video/v2.1/standard/text-to-video",
    provider:    "fal",
    type:        "video",
    name:        "Kling 2.1",
    description: "Kuaishou Kling 2.1 Standard — most popular video model. Excellent motion quality, great prompt following. Supports 5s and 10s clips.",
    pricing:     { input: 0.35, output: 0, currency: "USD" }, // per 5s clip
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "Kling",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
  {
    id:          "fal:fal-ai/kling-video/v2.1/pro/text-to-video",
    provider:    "fal",
    type:        "video",
    name:        "Kling 2.1 Pro",
    description: "Kuaishou Kling 2.1 Pro — highest quality Kling. More cinematic motion, sharper details. Best for professional video output.",
    pricing:     { input: 0.70, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "Kling",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
  {
    id:          "fal:fal-ai/wan/v2.1/text-to-video",
    provider:    "fal",
    type:        "video",
    name:        "WAN 2.1",
    description: "Alibaba WAN 2.1 — open video model with good quality/cost ratio. Reliable for creative and commercial use.",
    pricing:     { input: 0.20, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "WAN",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
  {
    id:          "fal:fal-ai/luma-dream-machine/ray-2",
    provider:    "fal",
    type:        "video",
    name:        "Luma Ray 2",
    description: "Luma AI Ray 2 — high quality cinematic video. Smooth motion, natural camera movement. Supports image-to-video.",
    pricing:     { input: 0.50, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "Luma",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
  {
    id:          "fal:fal-ai/minimax-video/video-01",
    provider:    "fal",
    type:        "video",
    name:        "MiniMax Hailuo",
    description: "MiniMax Hailuo Video 01 — strong motion dynamics, good for action and character animation.",
    pricing:     { input: 0.25, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "MiniMax",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
  {
    id:          "fal:fal-ai/cogvideox-5b",
    provider:    "fal",
    type:        "video",
    name:        "CogVideoX 5B",
    description: "Zhipu AI CogVideoX 5B — open source video model. Reliable, no content restrictions, good for general use.",
    pricing:     { input: 0.10, output: 0, currency: "USD" },
    free:        false,
    capabilities:     ["video-generation", "text-to-video"],
    modality:         ["text", "video"],
    architecture:     "CogVideoX",
    supportsStreaming: false,
    inputTypes:  ["text"],
    outputTypes: ["video"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class FalDiscovery implements ProviderDiscovery {
  name = "fal";

  constructor(private readonly hasApiKey: boolean) {}

  async discoverModels(): Promise<Model[]> {
    if (!this.hasApiKey) {
      logger.info("fal: No API key — skipping");
      return [];
    }
    const models = [...FAL_IMAGE_MODELS, ...FAL_VIDEO_MODELS];
    logger.info(`fal: ${FAL_IMAGE_MODELS.length} image + ${FAL_VIDEO_MODELS.length} video models (static)`);
    return models;
  }
}
