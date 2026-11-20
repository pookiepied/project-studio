import { describe, expect, it } from "vitest";
import { chromeEndpoint } from "../../src/chrome/endpoint.js";
import { ChromeSession, webUrl } from "../../src/chrome/session.js";

const browser = "/devtools/browser/b56a039f-1f52-4a29-9b32-33f707238e3c";

describe("the existing Chrome connection", () => {
  it("accepts Chrome's port file and stays on loopback", () => {
    expect(chromeEndpoint(`9223\r\n${browser}\r\n`)).toBe(`ws://127.0.0.1:9223${browser}`);
    for (const contents of ["", `0\n${browser}`, `65536\n${browser}`, "9223\n//example.test", "9223\n/devtools/page/anything", `9223\n${browser}\nsecret`]) {
      expect(chromeEndpoint(contents)).toBeUndefined();
    }
  });

  it("refuses browser internals, local files and URLs carrying credentials", () => {
    for (const url of ["chrome://settings", "file:///file", "javascript:alert(1)", "https://user:pass@example.test/"]) {
      expect(webUrl(url)).toBeUndefined();
    }
    expect(webUrl("https://example.test/ok")?.pathname).toBe("/ok");
  });

  it("serializes access and surfaces setup failure without leaking a path", async () => {
    const session = new ChromeSession(async () => { throw new Error("private path and contents"); });
    const pending = session.run("one", () => session.connect());
    await Promise.all([
      expect(session.run("two", async () => null)).rejects.toThrow(/Another Studio conversation/),
      expect(session.run("one", async () => null)).rejects.toThrow(/already running/),
      expect(pending).rejects.toThrow(/^Open Google Chrome 144/),
    ]);
    await expect(session.run("two", async () => "released")).resolves.toBe("released");
    await session.finish();
  });
});
