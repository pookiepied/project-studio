import { StudioError } from "../errors/error.js";
import { ErrorCodes } from "../errors/codes.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"]);

function isPrivateIPv4(h: string): boolean {
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}
function isPrivateIPv6(h: string): boolean {
  const v = h.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:");
}

export function validateFetchUrl(input: string): URL {
  if (!input || typeof input !== "string") throw new StudioError(ErrorCodes.INVALID_URL, "URL is required", 400);
  if (input.length > 2048) throw new StudioError(ErrorCodes.INVALID_URL, "URL too long", 400);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new StudioError(ErrorCodes.INVALID_URL, "URL malformed", 400);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new StudioError(ErrorCodes.INVALID_URL, `Scheme ${url.protocol} not allowed`, 400);
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) throw new StudioError(ErrorCodes.INVALID_URL, "Hostname not allowed", 400);
  if (isPrivateIPv4(url.hostname) || isPrivateIPv6(url.hostname)) throw new StudioError(ErrorCodes.INVALID_URL, "Private network URLs not allowed", 400);
  if (url.port && url.port !== "80" && url.port !== "443") throw new StudioError(ErrorCodes.INVALID_URL, `Port ${url.port} not allowed`, 400);
  return url;
}
