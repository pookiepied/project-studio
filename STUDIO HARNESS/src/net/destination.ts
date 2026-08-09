import { StudioError } from "../contracts/errors.js";

/**
 * Where a network call is allowed to go.
 *
 * ADR 0022: a network capability's *resource* is the destination host, so this
 * is the code that turns a URL into that resource and refuses the destinations
 * that are never offered and never grantable.
 *
 * It lives outside `tools/` on purpose. `fetch` needs it first, MCP over HTTP
 * needs it in Phase 11, and connectors need it after that. A rule that only one
 * caller enforces is a rule the second caller forgets.
 *
 * **This is not containment.** It stops the agent reaching our own internals —
 * a real class of accident — and does nothing about what the response says. The
 * second half of ADR 0022 covers that, and neither half substitutes for the
 * other.
 */

export type DestinationRefusal =
  /** Not a URL, or a URL with no host. */
  | "malformed"
  /** A scheme other than http or https: `file:`, `ftp:`, `data:`. */
  | "scheme"
  /** Loopback, link-local, private range, or a non-public name. */
  | "private";

const MESSAGE_BY_REFUSAL: Record<DestinationRefusal, string> = {
  malformed: "That is not a valid web address.",
  scheme: "Only http and https addresses can be fetched.",
  private:
    "That address is on this machine or this private network, so it cannot be fetched.",
};

export class DestinationError extends StudioError {
  readonly domain = "retrieval" as const;
  declare readonly kind: DestinationRefusal;

  constructor(kind: DestinationRefusal, options: { message?: string } = {}) {
    // Never retryable: a private address stays private and a bad URL stays bad.
    super(kind, options.message ?? MESSAGE_BY_REFUSAL[kind], { retryable: false });
    this.name = "DestinationError";
  }
}

/**
 * Hostnames that are never public, whatever DNS says.
 *
 * `localhost` is here because it is conventionally loopback but is still a name
 * that a resolver could point anywhere, and we do not want to depend on which.
 */
const BLOCKED_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

/** Suffixes reserved for local networks and testing. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * Whether a literal IPv4 address is outside the public internet.
 *
 * `169.254.0.0/16` earns its own mention: it holds the cloud metadata endpoint
 * `169.254.169.254`, which serves instance credentials to anything that asks.
 * It is the single most valuable address for an agent to be tricked into
 * fetching.
 */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/**
 * Whether a literal IPv6 address is outside the public internet.
 *
 * Includes IPv4-mapped forms (`::ffff:127.0.0.1`), which are the standard way
 * to write a blocked IPv4 address in a way an IPv4 check would miss.
 */
function isPrivateIpv6(host: string): boolean {
  const address = host.toLowerCase().replace(/^\[|\]$/g, "");

  if (address === "::" || address === "::1") return true;
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(address)) return true;
  if (/^fe[89ab]/.test(address)) return true;

  // IPv4-mapped addresses have two spellings, and `new URL` rewrites the
  // readable one into the other: `::ffff:127.0.0.1` comes back as
  // `::ffff:7f00:1`. Checking only the dotted form let loopback through, which
  // the every-spelling test caught.
  const mapped = /^::ffff:(.+)$/.exec(address);
  if (mapped?.[1]) {
    const rest = mapped[1];
    if (rest.includes(".")) return isPrivateIpv4(rest);

    const groups = rest.split(":");
    if (groups.length !== 2) return false;
    const high = Number.parseInt(groups[0] as string, 16);
    const low = Number.parseInt(groups[1] as string, 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return false;
    return isPrivateIpv4(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }

  return false;
}

/** True when the host must never be reached, whatever the permissions say. */
export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "") return true;
  if (BLOCKED_NAMES.has(name)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (name.includes(":") || name.startsWith("[")) return isPrivateIpv6(name);
  return isPrivateIpv4(name);
}

export interface Destination {
  /** The URL as it will actually be requested. */
  readonly url: string;
  /** The permission resource, e.g. `docs.example.com`. */
  readonly host: string;
}

/**
 * Parses a URL and refuses the destinations that are never allowed.
 *
 * Called on the URL the model supplied, **and again on every redirect target**,
 * and again after DNS resolution where the runtime lets us see it. A check
 * performed only on the typed address misses a public name that resolves to
 * `127.0.0.1` and a 302 that points there, which are the two ordinary shapes of
 * this attack.
 *
 * The host is derived here rather than taken from a model-supplied field. A
 * destination the model can spell separately from the URL is a destination the
 * model can widen.
 */
export function parseDestination(raw: string): Destination {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DestinationError("malformed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DestinationError("scheme");
  }
  if (url.hostname === "") {
    throw new DestinationError("malformed");
  }
  if (isPrivateHost(url.hostname)) {
    throw new DestinationError("private");
  }

  // Credentials in a URL would travel into a log line and into the provider's
  // request. Dropped rather than refused: the address is still fetchable.
  url.username = "";
  url.password = "";

  return { url: url.toString(), host: url.hostname.toLowerCase() };
}
