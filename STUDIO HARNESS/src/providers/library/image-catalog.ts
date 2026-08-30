import { findPackageJSON } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ProviderConfigurationError } from "../../contracts/models.js";

/**
 * The second catalog source: Pi's image models.
 *
 * Pi keeps these in a separate generated collection from its language models,
 * shipped at `dist/image-models.js` with `getImageProviders` / `getImageModels`.
 * The subpath is absent from the package's exports map - only `.`, `./compat`,
 * `./providers/*`, `./api/*`, and a few named entry points are exported - so
 * the module is reached by resolving the package root and importing the file
 * by path. That is a deliberate deep read of an installed package, not an
 * accident to fix: the file is generated data that moves with the package, and
 * vendoring a copy would go stale the first time Pi regenerated it.
 *
 * One provider and 35 image models at the version this task was built against,
 * all through OpenRouter. Nothing for video, speech, transcription, search, or
 * fetch exists anywhere in Pi's catalogs - those live in the declared catalog.
 */

/** The fields of Pi's image model record this catalog actually consumes. */
export interface PiImageModel {
  readonly id: string;
  readonly name: string;
  readonly api: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly input: readonly string[];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
}

interface ImageCatalogModule {
  getImageProviders(): readonly string[];
  getImageModels(provider: string): readonly PiImageModel[];
}

function isImageCatalogModule(value: unknown): value is ImageCatalogModule {
  if (!isRecord(value)) return false;
  return (
    typeof value.getImageProviders === "function" &&
    typeof value.getImageModels === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let cached: ImageCatalogModule | undefined;

async function imageCatalogModule(): Promise<ImageCatalogModule> {
  if (cached !== undefined) return cached;

  // The package is ESM-only (its exports map names only `import` conditions,
  // so a CJS require.resolve refuses it); `findPackageJSON` locates the
  // package the way Node's own resolver walks, exports map aside. The data
  // file sits beside the compiled entry it is generated with.
  const manifest = findPackageJSON("@earendil-works/pi-ai", import.meta.url);
  if (manifest === undefined) {
    throw new ProviderConfigurationError(
      "The image model catalog shipped with the local runtime could not be located.",
    );
  }
  const url = pathToFileURL(join(manifest, "..", "dist", "image-models.js")).href;

  let loaded: unknown;
  try {
    loaded = await import(url);
  } catch {
    throw new ProviderConfigurationError(
      "The image model catalog shipped with the local runtime could not be loaded.",
    );
  }
  if (!isImageCatalogModule(loaded)) {
    throw new ProviderConfigurationError(
      "The image model catalog shipped with the local runtime does not have the expected shape.",
    );
  }

  cached = loaded;
  return cached;
}

export async function imageCatalogProviders(): Promise<readonly string[]> {
  return (await imageCatalogModule()).getImageProviders();
}

export async function imageCatalogModels(
  providerId: string,
): Promise<readonly PiImageModel[]> {
  return (await imageCatalogModule()).getImageModels(providerId);
}
