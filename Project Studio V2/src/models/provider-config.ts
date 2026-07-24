import * as v from "valibot";

import {
  modelSourceSchema,
  ProviderConfigurationError,
  type ModelSource,
} from "../contracts/models.js";

export const providerConfigSchema = v.object({
  source: modelSourceSchema,
});

export type ProviderConfig = v.InferOutput<typeof providerConfigSchema>;

export interface ProviderConfigInput {
  readonly source?: ModelSource;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function resolveProviderConfig(
  input: ProviderConfigInput = {},
): ProviderConfig {
  const rawSource =
    input.source ?? readEnv("PROJECT_STUDIO_MODEL_SOURCE") ?? "test";

  try {
    return v.parse(providerConfigSchema, { source: rawSource });
  } catch {
    throw new ProviderConfigurationError(
      `Invalid model source "${rawSource}". Expected one of: test, local, studio-cloud.`,
    );
  }
}
