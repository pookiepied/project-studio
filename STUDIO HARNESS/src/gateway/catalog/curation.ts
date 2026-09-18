import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";

import { ProviderConfigurationError } from "../../contracts/models.js";
import { providerKindSchema, type ProviderKind } from "../../contracts/providers.js";
import { installationRoot } from "../../platform/paths.js";

/**
 * Which vendors the library offers, as a value rather than as code.
 *
 * The two catalogs between them know every vendor the harness can drive -
 * Pi's thirty-odd language providers, the declared media and retrieval
 * vendors - and most of that breadth is noise to a person adding a
 * connection: three regional plans of one vendor, aggregators that
 * overlap everything else, a vendor whose only key is an OAuth flow. The
 * choice of which to offer used to be the shape of a protocol allow-list
 * and the contents of a TypeScript array, so changing it meant a build.
 * It is a file now, `catalog/providers.json` beside the package, read
 * when the library is listed: one row per vendor per kind, enabled or not, and a
 * vendor absent from the file is not offered either, so the file is the
 * whole answer and not a set of exceptions to some other list.
 *
 * Per kind rather than per vendor, because one key credibly serves
 * several: a person may want OpenAI's images and not its chat, and a row
 * that answered both at once would have made that a code change again.
 *
 * Only the *library* reads this - what a settings screen offers to add.
 * A connection that already exists resolves its wires through
 * `libraryServesFor`, which does not consult the file, so disabling a
 * vendor here never breaks a connection a person already made.
 *
 * The file is validated as it is read, and a malformed file is a
 * configuration error that names the path and the field: the harness
 * still starts, and the library listing fails with the sentence that says
 * what to fix. A missing file is the same error rather than "offer everything",
 * because a curation that silently widens to the whole catalog is the
 * failure this file exists to prevent.
 */

const curatedProviderSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  kind: providerKindSchema,
  enabled: v.boolean(),
});

const curationFileSchema = v.object({
  providers: v.array(curatedProviderSchema),
});

export type CuratedProvider = v.InferOutput<typeof curatedProviderSchema>;

/** Where the shipped curation lives: beside the package, not in the bundle, so an edit needs no build. */
export function curationPath(): string {
  return join(installationRoot(), "catalog", "providers.json");
}

/** The file, parsed and validated. Every failure is one sentence naming the path. */
export function readCuration(path: string = curationPath()): readonly CuratedProvider[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ProviderConfigurationError(
      `The provider curation file could not be read at ${path}. It ships with the harness; restore it from the repository.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProviderConfigurationError(
      `The provider curation file at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = v.safeParse(curationFileSchema, parsed);
  if (!result.success) {
    const issue = result.issues[0];
    const where = issue.path?.map((segment) => String(segment.key)).join(".") ?? "";
    throw new ProviderConfigurationError(
      `The provider curation file at ${path} has a problem at "${where}": ${issue.message}`,
    );
  }
  return result.output.providers;
}

/** The kinds each vendor is offered for. Read per call: the file is small and the caller is a settings screen. */
export function curatedKinds(path: string = curationPath()): ReadonlyMap<string, ReadonlySet<ProviderKind>> {
  const kinds = new Map<string, Set<ProviderKind>>();
  for (const row of readCuration(path)) {
    if (!row.enabled) continue;
    let set = kinds.get(row.id);
    if (set === undefined) {
      set = new Set<ProviderKind>();
      kinds.set(row.id, set);
    }
    set.add(row.kind);
  }
  return kinds;
}
