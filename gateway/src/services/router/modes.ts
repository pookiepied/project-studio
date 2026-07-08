/**
 * User-facing AI mode (tier) configuration.
 *
 * Single source of truth for the Auto / Fast / Standard / Advanced presets.
 * The frontend fetches this config via GET /v1/modes at runtime.
 */

export interface ModeConfig {
  id: string;
  label: string;
  description: string;
  modelId: string;
  icon: "leaf" | "lightning" | "star" | "sparkle";
}

export const MODES: ModeConfig[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Smart routing for any conversation",
    modelId: "auto",
    icon: "leaf",
  },
  {
    id: "fast",
    label: "Fast",
    description: "Mimo V2 Flash · Instant replies",
    modelId: "openrouter:xiaomi/mimo-v2-flash",
    icon: "lightning",
  },
  {
    id: "standard",
    label: "Standard",
    description: "Qwen 3.6 Plus · Balanced quality",
    modelId: "openrouter:qwen/qwen3.6-plus-04-02",
    icon: "star",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "GLM 5.1 · Maximum capability",
    modelId: "openrouter:thudm/glm-5.1",
    icon: "sparkle",
  },
];
