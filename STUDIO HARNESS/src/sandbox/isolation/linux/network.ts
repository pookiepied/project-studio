import { execFileSync } from "node:child_process";

import { resolveBinary } from "../../../vendor/resolver.js";
import { asIdentity, type ProbeIdentity } from "./identity.js";

/**
 * What "the network is allowed" means for a contained child on Linux.
 *
 * ## The problem this exists to fix
 *
 * `bwrap --share-net` gives the child the **host's** network namespace, which is
 * not a network — it is the machine. Measured on Ubuntu 24.04, a contained child
 * with the operator's network switch on reached the host's `127.0.0.1`, an
 * RFC1918 address on `docker0`, and a Tailscale peer. Windows implements the same
 * boolean as the `internetClient` capability, which reaches a public address and
 * is refused loopback and the private ranges. One field, two boundaries, and the
 * Linux one is the wrong one: a contained MCP server could call its API *and* the
 * user's dev server, local database, admin panel or router.
 *
 * ## The shape of the fix
 *
 * `pasta`, from `passt`, builds a network namespace in userspace and runs a
 * command inside it. That composes with `bwrap` rather than replacing it:
 *
 * ```
 * pasta --config-net … — sh -c <setup> sh  bwrap --unshare-all --share-net … — child
 * ```
 *
 * `--share-net` still says "share the parent's network namespace" — the parent is
 * now `pasta`'s namespace instead of the machine's. Everything else about
 * containment is untouched, and the network-off path never involves `pasta` at
 * all: an empty namespace is already the strictest possible answer.
 *
 * ## Why routing, and not a firewall
 *
 * `pasta` forwards what it is given by opening ordinary sockets on the host, so
 * *it* has no opinion about destinations — with the port forwarding off, a child
 * still reached `172.17.0.1` and a Tailscale peer. The private ranges have to be
 * refused inside the namespace, and a blackhole route does that with no
 * `nftables` dependency, no rules to get subtly wrong, and an immediate
 * `ENETUNREACH` rather than a timeout.
 *
 * The child cannot undo them. `bwrap` puts it in a *nested* user namespace, and
 * capabilities there do not reach a network namespace owned by the parent — the
 * child's `ip route del` and `ip link set … down` both come back `Operation not
 * permitted`, measured rather than assumed.
 */

/**
 * The destinations a granted network still does not include.
 *
 * RFC1918 plus the two that are easy to forget and are the reason this list is
 * written out rather than described: `100.64.0.0/10` is carrier-grade NAT, which
 * is what Tailscale and most mesh VPNs live on, and `169.254.0.0/16` is
 * link-local — the home of `169.254.169.254`, every cloud provider's unauthenticated
 * credentials endpoint.
 *
 * `127.0.0.0/8` is deliberately **absent**. Inside the namespace it is the
 * child's own loopback, reaching nothing but itself, and blackholing it would
 * break a program that binds a local port and talks to it — a debugger, a test
 * server, a language runtime's own IPC. The host's loopback is already
 * unreachable because it is a different namespace, which is the difference
 * between this and the Windows capability: there, loopback is refused because
 * loopback *is* the host.
 */
export const PRIVATE_V4: readonly string[] = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
];

/** Unique-local and link-local. The IPv6 halves of the same list. */
export const PRIVATE_V6: readonly string[] = ["fc00::/7", "fe80::/10"];

/**
 * What runs inside the new namespace, before the child does.
 *
 * A constant. The child's executable and arguments arrive as `"$@"` and are
 * never interpolated into it, so there is no quoting to get wrong and no way for
 * a program name to become shell syntax.
 *
 * **Every route on the interface is flushed**, rather than the private ones being
 * deleted selectively. `pasta --config-net` copies the host's address and its
 * on-link subnet route, and on a laptop that subnet *is* the user's LAN —
 * `192.168.1.0/24` beats a `192.168.0.0/16` blackhole on longest prefix, so the
 * selective version would leave the LAN reachable on exactly the machines most
 * likely to have one. Flushing collapses that into one path with no host-shaped
 * branch, which also means no branch that only runs on somebody else's network.
 *
 * The single `default dev` route that replaces them needs no gateway: `pasta`
 * answers for every address on the tap, so a route with no `via` is enough, and
 * it keeps the router itself off the reachable list.
 *
 * The address `pasta` copied is kept on purpose. It means the host's own address
 * resolves, inside the namespace, to the child itself — so a service bound to
 * `0.0.0.0` on the user's machine is not reachable through the back door of its
 * public address. Measured: `sshd` on the host's public IP came back refused.
 *
 * `set -eu` makes it fail closed. If a route cannot be added, the child never
 * execs, because the alternative is a child that runs with the network wider
 * than the operator agreed to and nothing saying so.
 */
export const NETWORK_SETUP: string = [
  "set -eu",
  // A child is given an empty `PATH` on purpose — an MCP server should not find
  // tools nobody approved — and this script runs *before* that child, in the
  // host's filesystem, where it needs `ip`, `sed` and `head`. So it borrows a
  // path for its own lookups and puts the original back before `exec`. Found by
  // running it: with the empty PATH inherited, every command came back
  // `not found` and the script failed closed, which is the right failure and a
  // useless one.
  "_studio_path=${PATH-}",
  "PATH=/usr/sbin:/usr/bin:/sbin:/bin",
  'dev=$(ip -o -4 route show default | sed -n "s/.* dev \\([^ ]*\\).*/\\1/p" | head -n 1)',
  '[ -n "$dev" ]',
  'ip route flush dev "$dev"',
  'ip route add default dev "$dev"',
  `for r in ${PRIVATE_V4.join(" ")}; do ip route add blackhole "$r"; done`,
  // IPv6 is best-effort by necessity: a host without it has no default route to
  // find, and the child then has no IPv6 to reach anything with either.
  'dev6=$(ip -o -6 route show default 2>/dev/null | sed -n "s/.* dev \\([^ ]*\\).*/\\1/p" | head -n 1)',
  'if [ -n "$dev6" ]; then',
  '  ip -6 route flush dev "$dev6"',
  '  ip -6 route add default dev "$dev6"',
  `  for r in ${PRIVATE_V6.join(" ")}; do ip -6 route add blackhole "$r"; done`,
  "fi",
  // Handed back exactly as found, so the child's environment is the one the
  // sandbox meant to give it and not the one this script needed.
  "PATH=$_studio_path",
  "unset _studio_path",
  'exec "$@"',
].join("\n");

/**
 * `pasta`'s own arguments, before the command it is to run.
 *
 * `--config-net` builds and configures the namespace. The four `none`s turn off
 * port forwarding, which is not a hardening extra: `pasta`'s default forwards
 * every port between the namespace and the host's loopback, and with them left
 * out a child reached a server on the host's `127.0.0.1` exactly as it did
 * through `--share-net`. The whole fix depends on these four.
 */
const PASTA_ARGUMENTS: readonly string[] = [
  "--config-net",
  "-t",
  "none",
  "-u",
  "none",
  "-T",
  "none",
  "-U",
  "none",
];

/**
 * Wraps a command so it runs in a namespace with a narrowed network.
 *
 * Pure, for the same reason `bwrapArgs` is: what a command line *says* can be
 * asserted on any machine, and what the kernel does with it belongs in the
 * integration suite.
 *
 * The `sh` after `-c` is not a mistake — it becomes `$0`, so the caller's
 * executable lands at `$1` and `exec "$@"` runs the right thing.
 */
export function withNarrowedNetwork(
  pastaPath: string,
  shellPath: string,
  command: readonly string[],
  // A non-empty tuple, because the caller's first job is to split the head
  // off as the executable: saying so here is what lets it do that without an
  // assertion about a value this function always supplies.
): readonly [string, ...string[]] {
  return [pastaPath, ...PASTA_ARGUMENTS, "--", shellPath, "-c", NETWORK_SETUP, "sh", ...command];
}

/** Where `pasta` is, or a refusal that names the package to install. */
export function pastaPath(): string {
  return resolveBinary("pasta").path;
}

/** What a probe of the network stack found. */
export interface NetworkProbe {
  readonly ok: boolean;
  /** What went wrong, quoted. Never a guess. */
  readonly detail?: string;
}

/**
 * Actually builds a namespace and looks at the exit code.
 *
 * The same argument as the `bwrap` probe, and the same reason it cannot be a
 * `PATH` check: `pasta` creates a user namespace too, so on the machines this
 * whole stage is about it is installed, on `PATH`, and refused by the kernel
 * until `sandbox:prepare` has run. Answering from the filename would report a
 * network the child cannot have.
 */
export function probeNetwork(path: string, as?: ProbeIdentity): NetworkProbe {
  try {
    execFileSync(path, [...PASTA_ARGUMENTS, "--", "/bin/true"], {
      timeout: 15_000,
      stdio: ["ignore", "ignore", "pipe"],
      ...asIdentity(as),
    });
    return { ok: true };
  } catch (cause) {
    const stderr = (cause as { stderr?: Buffer | string } | null)?.stderr;
    const text = stderr === undefined ? "" : String(stderr).trim();
    const detail =
      text !== "" ? (text.split("\n")[0] ?? text) : cause instanceof Error ? cause.message : String(cause);
    return { ok: false, detail };
  }
}
