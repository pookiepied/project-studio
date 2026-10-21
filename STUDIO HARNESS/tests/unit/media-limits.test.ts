import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_MAX_BYTES,
  TURN_IMAGE_MAX_BYTES,
  TURN_IMAGES_TOTAL_MAX_BYTES,
  TURN_MAX_DOCUMENTS,
  TURN_MAX_IMAGES,
} from "../../src/contracts/media-limits.js";

/**
 * The composer enforces what a turn may attach; the harness states the same
 * limits. The two packages cannot import each other, so this reads the
 * client's constants file and holds it to the harness's values.
 */
const CLIENT_LIMITS = join(import.meta.dirname, "../../../STUDIO/src/domain/attachments/limits.ts");

/** `export const NAME = <number expression>` values, evaluated from digits, `_` and `*` only. */
function clientConstants(): Map<string, number> {
  const source = readFileSync(CLIENT_LIMITS, "utf8");
  const values = new Map<string, number>();
  for (const match of source.matchAll(/^export const (\w+) = ([\d_ *]+)$/gm)) {
    const [, name, expression] = match;
    if (name === undefined || expression === undefined) continue;
    values.set(name, expression.split("*").map((part) => Number(part.trim().replace(/_/g, ""))).reduce((product, factor) => product * factor, 1));
  }
  return values;
}

describe("what a turn may attach", () => {
  it("is the same in the client composer as in the harness", () => {
    expect(Object.fromEntries(clientConstants())).toEqual({
      MAX_IMAGES_PER_TURN: TURN_MAX_IMAGES,
      MAX_IMAGE_BYTES: TURN_IMAGE_MAX_BYTES,
      MAX_IMAGE_BYTES_PER_TURN: TURN_IMAGES_TOTAL_MAX_BYTES,
      MAX_DOCUMENTS_PER_TURN: TURN_MAX_DOCUMENTS,
      MAX_DOCUMENT_BYTES: DOCUMENT_MAX_BYTES,
    });
  });

  it("keeps one turn's pictures inside the strictest request once base64-encoded", () => {
    // Anthropic's standard endpoints take 32 MB per request.
    expect((TURN_IMAGES_TOTAL_MAX_BYTES * 4) / 3).toBeLessThan(32_000_000 * 0.7);
  });
});
