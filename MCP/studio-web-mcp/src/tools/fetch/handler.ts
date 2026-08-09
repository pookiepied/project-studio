import type { ProviderConfig } from "../../config/env.js";
import { StudioError } from "../../errors/error.js";
import { ErrorCodes } from "../../errors/codes.js";
import { executeFetch } from "../../runtime/fetch/execute.js";

export async function handleFetch(input: unknown, cfg: ProviderConfig) {
  const parsed = input as { url?: string; max_chars?: number; offset?: number; format?: string };
  if (!parsed.url || typeof parsed.url !== "string") {
    throw new StudioError(ErrorCodes.INVALID_URL, "url is required", 400);
  }
  const result = await executeFetch(
    {
      url: parsed.url,
      max_chars: parsed.max_chars,
      offset: parsed.offset,
      format: parsed.format,
    },
    cfg,
  );
  return result;
}
