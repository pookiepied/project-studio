import { describe, expect, it } from "vitest";
import { StudioError } from "../../src/errors/error.js";
import { ErrorCodes } from "../../src/errors/codes.js";
import { normalizeProviderStatus, shouldFallback } from "../../src/errors/normalize.js";
import { toMcpError } from "../../src/errors/response.js";

describe("basic error codes", () => {
  it("maps 429 to RATE_LIMITED with fallback", () => {
    const err = normalizeProviderStatus(429, "tavily");
    expect(err.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(shouldFallback(err)).toBe(true);
  });
  it("does not fallback on 401", () => {
    const err = normalizeProviderStatus(401, "tavily");
    expect(err.code).toBe(ErrorCodes.AUTH_FAILED);
    expect(shouldFallback(err)).toBe(false);
  });
  it("converts StudioError to code+message", () => {
    const err = new StudioError(ErrorCodes.INVALID_URL, "bad url", 400);
    const payload = toMcpError(err);
    expect(payload.code).toBe(ErrorCodes.INVALID_URL);
    expect(payload.message).toBe("bad url");
  });
  it("handles plain Error as INTERNAL", () => {
    const payload = toMcpError(new Error("oops"));
    expect(payload.code).toBe(ErrorCodes.INTERNAL);
  });
});
