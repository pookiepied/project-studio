/**
 * Matching a call's *resource* against a permission pattern.
 *
 * Without this, policy sees only the capability: `git log` and `git push` are
 * one thing, and approving the first approves the second. Every comparable
 * product matches on arguments for exactly that reason.
 *
 * Two shapes, because one does not fit both. A path is hierarchical and needs
 * to distinguish "this directory" from "this directory and everything under
 * it". A command is not hierarchical — `git:push` has one level — and globbing
 * it as a path produces matches nobody intended.
 */

export type ResourceKind = "path" | "command";

/** What separates one level from the next, per kind. */
const SEPARATOR: Record<ResourceKind, string> = {
  path: "/",
  command: ":",
};

/**
 * Resources are compared case-insensitively on Windows, where `SRC/A.TS` and
 * `src/a.ts` are the same file and a case-sensitive rule would be trivially
 * evaded.
 */
const CASE_INSENSITIVE = process.platform === "win32";

/**
 * Normalizes a resource so a pattern written one way still matches.
 *
 * Backslashes become forward slashes: on Windows the same path arrives both
 * ways depending on who produced it, and a rule that matched only one spelling
 * would be a rule with a hole in it.
 */
export function normalizeResource(resource: string, kind: ResourceKind): string {
  const unified = kind === "path" ? resource.replaceAll("\\", "/") : resource;
  return CASE_INSENSITIVE ? unified.toLowerCase() : unified;
}

function escapeLiteral(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiles a pattern to a regular expression.
 *
 * `**` crosses separators, `*` does not, and everything else is literal. The
 * distinction is the whole point: `src/*` is "files directly in src" and
 * `src/**` is "src and everything beneath it". Collapsing them would make every
 * directory rule recursive whether the user meant it or not.
 */
function compile(pattern: string, kind: ResourceKind): RegExp {
  const separator = escapeLiteral(SEPARATOR[kind]);
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    // `src/**` covers `src` itself as well as everything beneath it, so the
    // separator in front of `**` is optional. Without this, a rule granting a
    // directory tree would not cover listing the directory it names.
    if (
      character === SEPARATOR[kind] &&
      pattern[index + 1] === "*" &&
      pattern[index + 2] === "*"
    ) {
      source += `(?:${separator}.*)?`;
      index += 2;
      continue;
    }

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
        continue;
      }
      source += `[^${separator}]*`;
      continue;
    }

    source += escapeLiteral(character ?? "");
  }

  return new RegExp(`^${source}$`);
}

/**
 * True when `resource` falls inside `pattern`.
 *
 * An undefined pattern means the rule or grant covers the whole capability
 * regardless of arguments — the behaviour everything had before resources
 * existed, kept so an unscoped rule still means what it always meant.
 */
export function matchesResource(
  pattern: string | undefined,
  resource: string | undefined,
  kind: ResourceKind,
): boolean {
  if (pattern === undefined) return true;
  // A pattern narrows a capability. A call that produced no resource cannot be
  // shown to fall inside that narrowing, so it does not match.
  if (resource === undefined) return false;

  return compile(normalizeResource(pattern, kind), kind).test(
    normalizeResource(resource, kind),
  );
}

/**
 * How specific a pattern is, for choosing between two that both match.
 *
 * An exact pattern beats a wildcard, and a wildcard beats none, so a narrow
 * grant is never shadowed by a broad one the user approved earlier.
 */
export function patternSpecificity(pattern: string | undefined): number {
  if (pattern === undefined) return 0;
  return pattern.includes("*") ? 1 : 2;
}
