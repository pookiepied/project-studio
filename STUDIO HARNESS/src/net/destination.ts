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
  readonly domain = "network" as const;
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
  /**
   * A cloud instance's metadata service, which hands instance credentials to
   * anything on the machine that asks for them.
   *
   * Separate from `private` because the answers differ. A private address is
   * refused by policy and is a perfectly ordinary place for a user to run
   * something — a server on their own network. This one is never a legitimate
   * destination for anything this harness does, so it is refused whoever wrote
   * the address.
   */
  | "metadata"
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

  // Named metadata endpoints that sit outside link-local and would otherwise be
  // classified as ordinary private addresses. Alibaba's is inside the
  // carrier-grade NAT range and Oracle's inside IETF protocol assignments, so
  // neither is caught by a range rule.
  if (host === "100.100.100.200" || host === "192.0.0.192") return "metadata";

  const [a = 0, b = 0] = octets;
  if (a === 127) return "loopback";
  if (a === 0) return "private"; // "this network"
  if (a === 10) return "private";
  // Link-local. AWS, GCP, and Azure all serve instance credentials from
  // 169.254.169.254, and nothing this harness does has a reason to reach any
  // address in the block, so the whole block is refused rather than one address.
  if (a === 169 && b === 254) return "metadata";
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
  // AWS serves instance credentials here over IPv6, and it sits inside the
  // unique-local block that the next line would otherwise call private.
  if (address === "fd00:ec2::254") return "metadata";
  // Unique local (fc00::/7).
  if (/^f[cd]/.test(address)) return "private";
  // Link-local (fe80::/10), the IPv6 counterpart of 169.254.0.0/16.
  if (/^fe[89ab]/.test(address)) return "metadata";

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

/**
 * Applies the `C-17` policy to a host and port, and returns what it was.
 *
 * Split out of `judgeDestination` because the policy has a second caller that
 * never sees a URL: the HTTP client judges **every address a name resolved
 * to**, and an address is a host and a port with no URL around it. The two must
 * be one function — a name that passes and an address that is never judged is
 * the rebinding attack, and two copies of this rule is how one of them gets
 * fixed.
 */
export function judgeHostPort(destination: HostPort, author: UrlAuthor): HostClass {
  const hostClass = classifyHostPort(destination);

  if (hostClass === "metadata" || hostClass === "own-port") {
    throw new DestinationError("private", {
      message:
        hostClass === "metadata"
          ? "That address belongs to a cloud provider's credential service, so nothing here may reach it."
          : "That address is Project Studio's own service, so nothing may reach it through the network.",
    });
  }

  if (hostClass === "private" && author === "model") {
    throw new DestinationError("private");
  }

  return hostClass;
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
  /** What the address turned out to be. */
  readonly hostClass: HostClass;
}

/**
 * Who chose this address.
 *
 * `C-17`: the guard follows the URL's **author**, not the address. A person who
 * typed an address into a settings form has already decided to reach it, and
 * refusing them their own machine is refusing the ordinary case — a local MCP
 * server is the normal kind. A model that produced an address inside a turn has
 * decided nothing; the address may have come from a web page it just read.
 */
export type UrlAuthor = "model" | "user";

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
  const destination = judgeDestination(raw, "model");

  // `fetch` reaches a page through a reading service, so it cannot serve an
  // address on this machine or this network however the permission question is
  // answered — the service is not on this machine. Refused here rather than
  // by the policy above, because this is a limit of one transport and not a
  // judgement about the address. `C-17` relaxed the *policy* for loopback; a
  // client that can actually open a local connection is what makes that
  // reachable, and it is not this one.
  if (destination.hostClass !== "public") {
    throw new DestinationError("private");
  }

  return destination;
}

/**
 * The `C-17` policy: judges an address against who chose it.
 *
 * | Class | A model chose it | A person typed it |
 * |---|---|---|
 * | public | allowed | allowed |
 * | loopback | allowed, and approval is still asked for host **and port** | allowed |
 * | private | refused | allowed |
 * | metadata | refused | refused |
 * | own-port | refused | refused |
 *
 * **Allowed is not approved.** Nothing here grants anything. Every destination
 * still goes through the kernel with the resource this returns, and the reason
 * loopback carries its port is that two ports on one host are two services —
 * approving a development server must not approve an unsecured database on the
 * same machine.
 *
 * **Two classes are refused whoever asked.** A metadata endpoint hands out
 * instance credentials and is never a legitimate destination for anything here.
 * An own-port is our own control plane, and reaching it is escalation rather
 * than a network call — a person typing it has misunderstood rather than
 * decided, and it would be a loop even if they had.
 *
 * **A private address is refused for a model and allowed for a person**,
 * because those are genuinely different situations. A user pointing a server at
 * a machine on their own network is ordinary. A model producing the same
 * address inside a turn has decided nothing — the address may have come from a
 * page it just read a moment earlier.
 */
export function judgeDestination(raw: string, author: UrlAuthor): Destination {
  const { url, hostPort } = parseUrl(raw);
  const hostClass = judgeHostPort(hostPort, author);

  // Credentials in a URL would travel into a log line and into the request
  // itself. Dropped rather than refused: the address is still reachable.
  url.username = "";
  url.password = "";

  return { url: url.toString(), host: destinationResource(hostPort), hostClass };
}
