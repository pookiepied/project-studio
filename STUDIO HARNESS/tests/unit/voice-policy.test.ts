import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { openDatabase } from "../../src/storage/database.js";
import { VoiceSettings } from "../../src/gateway/language/voice-settings.js";
import { voiceImagePath } from "../../src/conversations/voice-policy.js";

describe("voice observation and model roles", () => {
  it("admits conversation images and refuses traversal, sibling roots and other files", () => {
    const root = resolve("voice-fixture", "attachments");
    expect(voiceImagePath({ path: resolve(root, "picture.png") }, [root])).toBe(resolve(root, "picture.png"));
    for (const path of [resolve(root, "../private.png"), resolve(`${root}-other`, "a.png"), resolve(root, "secret.txt")]) {
      expect(() => voiceImagePath({ path }, [root])).toThrow(/only images/);
    }
  });

  it("persists a separate voice preference without changing the chat default", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const setting = new VoiceSettings(db);
      expect(setting.get()).toBeNull();
      setting.set("openrouter/example/fast");
      expect(new VoiceSettings(db).get()).toBe("openrouter/example/fast");
      expect(() => setting.set("unqualified")).toThrow();
      setting.set(null);
      expect(setting.get()).toBeNull();
    } finally { db.close(); }
  });
});
