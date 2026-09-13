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

  it("treats the env-named bound port as own, read at call time", () => {
    process.env.PROJECT_STUDIO_BOUND_PORT = "18892";
    try {
      expect(isOwnPort(18892)).toBe(true);
      expect(isOwnPort(18897)).toBe(false);

      // Renamed mid-process (a restart in the same process would do this):
      // the answer must follow the variable, not a value captured at import.
      process.env.PROJECT_STUDIO_BOUND_PORT = "18893";
      expect(isOwnPort(18892)).toBe(false);
      expect(isOwnPort(18893)).toBe(true);
    } finally {
      delete process.env.PROJECT_STUDIO_BOUND_PORT;
    }
  });

  it("still recognises an explicitly registered port beside the env-named one", () => {
    process.env.PROJECT_STUDIO_BOUND_PORT = "18894";
    try {
      registerOwnPort(18895);
      try {
        expect(isOwnPort(18894)).toBe(true);
        expect(isOwnPort(18895)).toBe(true);
      } finally {
        unregisterOwnPort(18895);
      }
      expect(isOwnPort(18895)).toBe(false);
      expect(isOwnPort(18894)).toBe(true);
    } finally {
      delete process.env.PROJECT_STUDIO_BOUND_PORT;
    }
  });
});
