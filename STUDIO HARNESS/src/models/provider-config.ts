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

/**
 * Selects the model source for this process.
 *
 * The source is a bootstrap-level decision read from
 * `PROJECT_STUDIO_MODEL_SOURCE` (default: `test`). It is deliberately not an
 * account preference or a per-run switch: there is no account model or run
 * router in this phase, and pretending otherwise would be dishonest. Product
 * account settings and per-run routing are deferred to product integration.
 *
 *  - `test`         in-process deterministic provider; network-free default;
 *  - `studio-cloud` the authenticated Studio Gateway source;
 *  - `local`        recognized but not operational (BYOK), and never silently
 *                   substituted with another source.
 */
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
