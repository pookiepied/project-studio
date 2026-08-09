import { describe, expect, it } from "vitest";

import {
  isOwnPort,
  registerOwnPort,
  unregisterOwnPort,
} from "../../src/net/own-ports.js";

describe("own ports registry", () => {
  it("is empty until a port is registered", () => {
    expect(isOwnPort(18888)).toBe(false);
  });

  it("registers and unregisters a port", () => {
    registerOwnPort(18889);
    try {
      expect(isOwnPort(18889)).toBe(true);
    } finally {
      unregisterOwnPort(18889);
    }
    expect(isOwnPort(18889)).toBe(false);
  });

  it("registering the same port twice is not an error", () => {
    registerOwnPort(18890);
    try {
      registerOwnPort(18890);
      expect(isOwnPort(18890)).toBe(true);
    } finally {
      unregisterOwnPort(18890);
    }
  });

  it("unregistering a port that was never registered is not an error", () => {
    unregisterOwnPort(18891);
    expect(isOwnPort(18891)).toBe(false);
  });
});
