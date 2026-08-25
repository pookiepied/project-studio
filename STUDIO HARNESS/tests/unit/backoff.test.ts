import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MULTIPLIER,
  getBackoffDelay,
} from "../../src/reliability/backoff.js";

describe("retry backoff", () => {
  describe("defaults", () => {
    it("exposes named defaults", () => {
      expect(DEFAULT_BASE_DELAY_MS).toBe(1_000);
      expect(DEFAULT_MULTIPLIER).toBe(2);
      expect(DEFAULT_MAX_DELAY_MS).toBe(30_000);
      expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
    });
  });

  describe("give-up", () => {
    it("gives up at exactly maxAttempts", () => {
      const maxAttempts = 3;
      expect(getBackoffDelay(0, { maxAttempts, random: () => 0.5 }).kind).toBe(
        "delay",
      );
      expect(getBackoffDelay(2, { maxAttempts, random: () => 0.5 }).kind).toBe(
        "delay",
      );
      expect(getBackoffDelay(3, { maxAttempts, random: () => 0.5 }).kind).toBe(
        "give-up",
      );
      expect(getBackoffDelay(4, { maxAttempts, random: () => 0.5 }).kind).toBe(
        "give-up",
      );
    });

    it("uses the default maxAttempts when not supplied", () => {
      expect(
        getBackoffDelay(DEFAULT_MAX_ATTEMPTS - 1, { random: () => 0.5 }).kind,
      ).toBe("delay");
      expect(
        getBackoffDelay(DEFAULT_MAX_ATTEMPTS, { random: () => 0.5 }).kind,
      ).toBe("give-up");
    });
  });

  describe("ceiling and jitter", () => {
    it("computes the ceiling as base * multiplier^attempt capped at maxDelay", () => {
      const baseDelayMs = 100;
      const multiplier = 2;
      const maxDelayMs = 500;
      // attempt 0: 100 * 2^0 = 100
      expect(
        getBackoffDelay(0, {
          baseDelayMs,
          multiplier,
          maxDelayMs,
          random: () => 1,
        }),
      ).toEqual({ kind: "delay", delayMs: 100 });
      // attempt 1: 100 * 2^1 = 200
      expect(
        getBackoffDelay(1, {
          baseDelayMs,
          multiplier,
          maxDelayMs,
          random: () => 1,
        }),
      ).toEqual({ kind: "delay", delayMs: 200 });
      // attempt 2: 100 * 2^2 = 400
      expect(
        getBackoffDelay(2, {
          baseDelayMs,
          multiplier,
          maxDelayMs,
          random: () => 1,
        }),
      ).toEqual({ kind: "delay", delayMs: 400 });
      // attempt 3: 100 * 2^3 = 800, capped at 500
      expect(
        getBackoffDelay(3, {
          baseDelayMs,
          multiplier,
          maxDelayMs,
          random: () => 1,
        }),
      ).toEqual({ kind: "delay", delayMs: 500 });
      // attempt 4: still capped
      expect(
        getBackoffDelay(4, {
          baseDelayMs,
          multiplier,
          maxDelayMs,
          random: () => 1,
        }),
      ).toEqual({ kind: "delay", delayMs: 500 });
    });

    it("with injected random 0 the delay is 0", () => {
      const result = getBackoffDelay(2, {
        baseDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 1000,
        random: () => 0,
      });
      expect(result).toEqual({ kind: "delay", delayMs: 0 });
    });

    it("with injected random 1 the delay is the ceiling", () => {
      const result = getBackoffDelay(1, {
        baseDelayMs: 100,
        multiplier: 3,
        maxDelayMs: 1000,
        random: () => 1,
      });
      // 100 * 3^1 = 300
      expect(result).toEqual({ kind: "delay", delayMs: 300 });
    });

    it("with random 0.5 the delay is half the ceiling", () => {
      const result = getBackoffDelay(1, {
        baseDelayMs: 200,
        multiplier: 2,
        maxDelayMs: 1000,
        random: () => 0.5,
      });
      // 200 * 2 = 400, half is 200
      expect(result).toEqual({ kind: "delay", delayMs: 200 });
    });

    it("respects the maximum delay for all attempts 0..20", () => {
      for (let attempt = 0; attempt <= 20; attempt += 1) {
        const result = getBackoffDelay(attempt, {
          baseDelayMs: 1000,
          multiplier: 2,
          maxDelayMs: 5000,
          maxAttempts: 30,
          random: () => 1,
        });
        if (result.kind === "delay") {
          expect(result.delayMs).toBeLessThanOrEqual(5000);
        }
      }
    });
  });

  describe("bounds and validity", () => {
    it("delay is never negative or NaN for attempts 0..20 with default random", () => {
      for (let attempt = 0; attempt <= 20; attempt += 1) {
        const result = getBackoffDelay(attempt, { maxAttempts: 30 });
        if (result.kind === "delay") {
          expect(result.delayMs).toBeGreaterThanOrEqual(0);
          expect(Number.isNaN(result.delayMs)).toBe(false);
          expect(Number.isFinite(result.delayMs)).toBe(true);
        }
      }
    });

    it("delay is never negative or NaN with injected extremes", () => {
      for (const random of [() => 0, () => 1, () => 0.5, () => 0.999]) {
        for (let attempt = 0; attempt <= 20; attempt += 1) {
          const result = getBackoffDelay(attempt, {
            maxAttempts: 30,
            random,
          });
          if (result.kind === "delay") {
            expect(result.delayMs).toBeGreaterThanOrEqual(0);
            expect(Number.isNaN(result.delayMs)).toBe(false);
          }
        }
      }
    });

    it("clamps a random source that returns outside [0, 1]", () => {
      // A caller-supplied random that returns 2 should be clamped to 1 (ceiling).
      expect(
        getBackoffDelay(0, {
          baseDelayMs: 100,
          maxDelayMs: 1000,
          random: () => 2,
        }),
      ).toEqual({ kind: "delay", delayMs: 100 });
      // And -1 should be clamped to 0.
      expect(
        getBackoffDelay(0, {
          baseDelayMs: 100,
          maxDelayMs: 1000,
          random: () => -1,
        }),
      ).toEqual({ kind: "delay", delayMs: 0 });
    });
  });

  describe("discriminated union", () => {
    it("returns a delay for attempts below the limit and give-up at the limit", () => {
      const maxAttempts = 2;
      const a = getBackoffDelay(0, { maxAttempts, random: () => 1 });
      const b = getBackoffDelay(1, { maxAttempts, random: () => 1 });
      const c = getBackoffDelay(2, { maxAttempts, random: () => 1 });

      expect(a.kind).toBe("delay");
      if (a.kind === "delay") expect(typeof a.delayMs).toBe("number");

      expect(b.kind).toBe("delay");
      expect(c.kind).toBe("give-up");
      if (c.kind === "give-up") {
        // give-up has no delayMs
        expect("delayMs" in c).toBe(false);
      }
    });
  });
});
