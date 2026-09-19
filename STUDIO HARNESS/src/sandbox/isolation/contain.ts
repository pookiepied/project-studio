import { SandboxError } from "../errors.js";
import type { SandboxPolicy } from "../policy.js";
import type { ContainedCommand, IsolationSupport } from "./backend.js";
import { isolationForKind, type ChildKind } from "./kinds.js";
import { hostIsolation } from "./registry.js";
import { satisfiesIsolation } from "../../contracts/effects.js";

/**
 * The single decision: given who chose this program, what command actually runs.
 *
 * There are two callers and they look nothing alike — `LocalSandbox.run`, which
 * spawns a model-chosen program and waits for it, and the MCP launcher, which
 * spawns a third party's server and streams to it for the rest of the session.
 * Neither can use the other's spawn. Both must reach the same verdict.
 *
 * So the *verdict* lives here and the spawning does not. A second copy of "is
 * this owed containment, and does this host have it" is exactly the shape of
 * `T-28` — one meaning in two places, each internally consistent, drifting in
 * silence.
 */
export interface ContainRequest {
  readonly policy: SandboxPolicy;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** See `ContainmentRequest.network` — internet only, never loopback or LAN. */
  readonly network: boolean;
  /** How the launcher joins the child's arguments. See `ContainmentRequest`. */
  readonly lineJoin?: "argv" | "command-line";
  /** Read-only grants for the program's own files. See `program-roots.ts`. */
  readonly programRoots?: readonly string[];
}

export async function containCommand(
  kind: ChildKind,
  request: ContainRequest,
  support: IsolationSupport = hostIsolation(),
): Promise<ContainedCommand> {
  const required = isolationForKind(kind);
  const plain: ContainedCommand = { executable: request.executable, args: request.args };

  // A kind that needs nothing is not wrapped just because a backend happens to
  // exist — that is the `tool` row, and it is what keeps the snapshot system's
  // `git` calls working.
  if (required === "in-process") return plain;

  const backend = support.backend;
  if (backend === undefined) {
    // Gate-only, and said so only when a fence was asked for (ADR 0057). A
    // shortfall is only ever recorded by measuring the registry, which only
    // happens once the fence is wanted; `hostIsolation()` answers with no
    // shortfall at all until then, so a host that never wanted a fence has
    // nothing to say here.
    return support.shortfall.length > 0
      ? { ...plain, note: gateOnlyNote(support.shortfall.join(" ")) }
      : plain;
  }
  if (!satisfiesIsolation(backend.level, required)) return plain;

  try {
    return await backend.contain({
      policy: request.policy,
      executable: request.executable,
      args: request.args,
      cwd: request.cwd,
      network: request.network,
      ...(request.lineJoin === undefined ? {} : { lineJoin: request.lineJoin }),
      ...(request.programRoots === undefined ? {} : { programRoots: request.programRoots }),
    });
  } catch (error) {
    // The backend refused this one call - the network program missing for a
    // networked command is the Linux case - after the probe said the fence
    // works. The backend's own words stay its own (it is untouched by ADR
    // 0057); what changes is that the call runs under the gate with the
    // refusal beside its output instead of not running at all.
    if (error instanceof SandboxError && error.kind === "unsupported_isolation") {
      return { ...plain, note: gateOnlyNote(error.message) };
    }
    throw error;
  }
}

function gateOnlyNote(reason: string): string {
  return `This command ran without the sandbox fence, under the permission gate only. ${reason}`;
}
