import { resolve, relative, isAbsolute, extname } from "node:path";
import { ProviderConfigurationError } from "../contracts/models.js";

/** Only conversation-owned image files are observations in the voice role. */
export function voiceImagePath(input: unknown, roots: readonly string[]): string {
  if (typeof input !== "object" || input === null || !("path" in input) || typeof input.path !== "string") {
    throw new ProviderConfigurationError("View an image by its conversation attachment or artifact path.");
  }
  const path = resolve(input.path);
  const allowed = roots.some((root) => {
    const tail = relative(resolve(root), path);
    return tail !== "" && tail !== ".." && !tail.startsWith(`..\\`) && !tail.startsWith("../") && !isAbsolute(tail);
  });
  if (!allowed || ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(path).toLowerCase())) {
    throw new ProviderConfigurationError("The voice agent can view only images attached to or generated in this conversation. Delegate other inspection.");
  }
  return path;
}
