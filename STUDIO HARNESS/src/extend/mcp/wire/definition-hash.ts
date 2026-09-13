import { createHash } from "node:crypto";

/**
 * A stable hash of a tool definition.
 *
 * An approval is given after a person reads a tool's name, description, and
 * input schema. If any of those change, the approval was for something else.
 * This hash is stored on the grant; changing the definition changes the hash
 * and therefore asks again.
 */

export interface ToolDefinitionInput {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    // Array order is meaningful and must be preserved. `undefined` inside an
    // array becomes `null` in JSON, so an array with `undefined` and an array
    // with `null` must not be conflated at the canonical layer — but the JSON
    // layer already does that, and the hash must match what JSON would
    // produce for the same logical value. Mapping `undefined` to `null`
    // explicitly keeps the hash stable with `JSON.stringify`'s own rule.
    return (value as unknown[]).map((element) => {
      if (element === undefined) return null;
      const canonical = canonicalize(element);
      return canonical === undefined ? null : canonical;
    });
  }

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(record).sort();
  for (const key of keys) {
    const v = record[key];
    // `undefined` and a missing key hash the same — both are omitted. `null`
    // is a value and is not omitted, which is why the check is for
    // `undefined` and not for falsiness.
    if (v === undefined) continue;
    const canonical = canonicalize(v);
    if (canonical !== undefined) {
      sorted[key] = canonical;
    }
  }
  return sorted;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Hashes a tool definition with SHA-256.
 *
 * The same definition hashes the same however the JSON keys are ordered —
 * object keys are sorted recursively through arrays and nested objects, while
 * array order is preserved. `undefined` and a missing key hash the same;
 * `null` does not. Whitespace inside `description` is significant and is not
 * normalized, because it is what a person read.
 */
export function hashToolDefinition(input: ToolDefinitionInput): string {
  const payload = {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
  };
  const stable = stableStringify(payload);
  return createHash("sha256").update(stable).digest("hex");
}

/** Convenience for the three-argument call site. */
export function hashDefinition(
  name: string,
  description: string,
  inputSchema: unknown,
): string {
  return hashToolDefinition({ name, description, inputSchema });
}
