import { StudioError } from "../contracts/errors.js";
import { isOwnPort } from "./own-ports.js";

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

/** A destination that has been parsed but not yet judged. */
export interface HostPort {
  readonly host: string;
  /** Already defaulted from the scheme: 80 for http, 443 for https. */
  readonly port: number;
}

export type HostClass =
  | "public"
  | "loopback"
  | "private"
  | "own-port";

/**
 * Hostnames that are never public, whatever DNS says.
 *
 * `localhost` is here because it is conventionally loopback but is still a name
 * that a resolver could point anywhere, and we do not want to depend on which.
 */
const BLOCKED_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

/**
 * Suffixes reserved for local networks and testing.
 *
 * `.localhost` is deliberately absent: RFC 6761 reserves it for *this machine*,
 * so it is loopback rather than merely non-public and is classified above. An
 * entry here as well would be dead — the loopback branch runs first — and a
 * dead entry is the kind that gets copied into the next list and believed.
 */
const BLOCKED_SUFFIXES = [".local", ".internal", ".home.arpa"];

/**
 * Classifies a literal IPv4 address.
 *
 * `169.254.0.0/16` earns its own mention: it holds the cloud metadata endpoint
 * `169.254.169.254`, which serves instance credentials to anything that asks.
 * It is the single most valuable address for an agent to be tricked into
 * fetching.
 */
function classifyIpv4(host: string): HostClass {
  const parts = host.split(".");
  if (parts.length !== 4) return "public";

  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return "public";
  }

  const [a = 0, b = 0] = octets;
  if (a === 127) return "loopback";
  if (a === 0) return "private"; // "this network"
  if (a === 10) return "private";
  if (a === 169 && b === 254) return "private"; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // carrier-grade NAT
  if (a >= 224) return "private"; // multicast and reserved
  return "public";
}

/**
 * Classifies a literal IPv6 address.
 *
 * Includes IPv4-mapped forms (`::ffff:127.0.0.1`), which are the standard way
 * to write a blocked IPv4 address in a way an IPv4 check would miss.
 */
function classifyIpv6(host: string): HostClass {
  const address = host.toLowerCase().replace(/^\[|\]$/g, "");

  if (address === "::1") return "loopback";
  if (address === "::") return "private";
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(address)) return "private";
  if (/^fe[89ab]/.test(address)) return "private";

  // IPv4-mapped addresses have two spellings, and `new URL` rewrites the
  // readable one into the other: `::ffff:127.0.0.1` comes back as
  // `::ffff:7f00:1`. Checking only the dotted form let loopback through, which
  // the every-spelling test caught.
  const mapped = /^::ffff:(.+)$/.exec(address);
  if (mapped?.[1]) {
    const rest = mapped[1];
    if (rest.includes(".")) return classifyIpv4(rest);

    const groups = rest.split(":");
    if (groups.length !== 2) return "public";
    const highRaw = groups[0];
    const lowRaw = groups[1];
    if (highRaw === undefined || lowRaw === undefined) return "public";
    const high = Number.parseInt(highRaw, 16);
    const low = Number.parseInt(lowRaw, 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return "public";
    return classifyIpv4(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }

  return "public";
}

function classifyHost(host: string): HostClass {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "") return "private";
  if (BLOCKED_NAMES.has(name)) return "loopback";
  // RFC 6761 reserves the whole `.localhost` tree for this machine, so
  // `api.localhost` is loopback and not merely non-public.
  if (name.endsWith(".localhost")) return "loopback";
  if (BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "private";
  if (name.includes(":") || name.startsWith("[")) return classifyIpv6(name);
  return classifyIpv4(name);
}

/** True when the host must never be reached, whatever the permissions say. */
export function isPrivateHost(host: string): boolean {
  return classifyHost(host) !== "public";
}

export function classifyHostPort(destination: HostPort): HostClass {
  const hostClass = classifyHost(destination.host);
  // Our own listening ports are the control plane. Reaching them is
  // escalation, and that holds even if some loopback is later allowed.
  if (hostClass === "loopback" && isOwnPort(destination.port)) {
    return "own-port";
  }
  return hostClass;
}

/**
 * Puts an IPv6 literal back in its brackets before a port is appended.
 *
 * `::1` and port 443 would otherwise read as `::1:443`, which is also a valid
 * spelling of a *different* address. `new URL().hostname` already keeps the
 * brackets, so this only matters for a hand-built `HostPort` — but a resource
 * string is compared against a stored grant, and two spellings of one
 * destination is the bug that makes a grant match something it never named.
 */
function bracketIpv6(host: string): string {
  if (!host.includes(":") || host.startsWith("[")) return host;
  return `[${host}]`;
}

export function destinationResource(destination: HostPort): string {
  const hostClass = classifyHostPort(destination);
  const host = bracketIpv6(destination.host.toLowerCase());
  // Loopback destinations are scoped by port: two ports on the same loopback
  // host are different services, and approving one must not approve the other.
  // A public host is the host alone, unchanged from how fetch has always
  // named it. Own-port is a loopback port we run; it is never offered, but
  // its resource is still host and port so the two spellings stay in one
  // place.
  if (hostClass === "loopback" || hostClass === "own-port") {
    return `${host}:${destination.port}`;
  }
  return host;
}

export interface Destination {
  /** The URL as it will actually be requested. */
  readonly url: string;
  /** The permission resource, e.g. `docs.example.com`. */
  readonly host: string;
}

function portFromUrl(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Parses and checks the shape of a URL, without judging where it points.
 *
 * Returns the `URL` as well as the host and port, so a caller that needs the
 * address itself does not parse the same string a second time. Two parses would
 * be two chances to disagree about what the string meant.
 */
function parseUrl(raw: string): { url: URL; hostPort: HostPort } {
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

  return { url, hostPort: { host: url.hostname, port: portFromUrl(url) } };
}

export function parseHostPort(raw: string): HostPort {
  return parseUrl(raw).hostPort;
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
  const { url, hostPort } = parseUrl(raw);
  const hostClass = classifyHostPort(hostPort);
  // All three non-public classes are refused with the same kind and message
  // today. The split makes a future loopback policy expressible; acting on it
  // is a different item, and own-port stays refused even then.
  if (hostClass !== "public") {
    throw new DestinationError("private");
  }

  // Credentials in a URL would travel into a log line and into the provider's
  // request. Dropped rather than refused: the address is still fetchable.
  url.username = "";
  url.password = "";

  return { url: url.toString(), host: destinationResource(hostPort) };
}
