import { describe, expect, it } from "vitest";

import { createStudioUuid, isStudioUuid } from "../../src/contracts/uuid.js";

describe("Project Studio identity", () => {
  it("creates RFC 4122 version 4 UUIDs", () => {
    const id = createStudioUuid();

    expect(isStudioUuid(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]?.toLowerCase());
  });

  it("does not confuse domain keys with generated UUIDs", () => {
    expect(isStudioUuid("studio-host")).toBe(false);
    expect(isStudioUuid("native/write")).toBe(false);
    expect(isStudioUuid(undefined)).toBe(false);
  });

  it("does not repeat generated identities", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => createStudioUuid()));

    expect(ids).toHaveLength(1_000);
  });
});
