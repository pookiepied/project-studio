import { describe, expect, it } from "vitest";

import { parseHarnessReadiness } from "../../src/host/readiness.js";

describe("Harness readiness frames", () => {
  it("accepts a structured loopback endpoint", () => {
    const result = parseHarnessReadiness(
      JSON.stringify({
        type: "project-studio.harness.ready",
        version: 1,
        pid: 123,
        host: "127.0.0.1",
        port: 45_678,
        clientId: "studio-host",
        sessionId: "session-1",
      }),
    );

    expect(result).toEqual({
      type: "project-studio.harness.ready",
      version: 1,
      pid: 123,
      host: "127.0.0.1",
      port: 45_678,
      clientId: "studio-host",
      sessionId: "session-1",
    });
  });

  it.each([
    "not json",
    JSON.stringify({ type: "other", version: 1 }),
    JSON.stringify({
      type: "project-studio.harness.ready",
      version: 1,
      pid: 123,
      host: "0.0.0.0",
      port: 45_678,
      clientId: "studio-host",
      sessionId: "session-1",
    }),
    JSON.stringify({
      type: "project-studio.harness.ready",
      version: 1,
      pid: 123,
      host: "127.0.0.1",
      port: 0,
      clientId: "studio-host",
      sessionId: "session-1",
    }),
  ])("rejects a non-readiness frame: %s", (line) => {
    expect(parseHarnessReadiness(line)).toBeUndefined();
  });
});
