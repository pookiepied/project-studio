import type { SandboxPolicy } from "../policy.js";
import {
  assertIsolationAvailable,
  type ContainedCommand,
  type IsolationSupport,
} from "./backend.js";
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
  // Raised before anything is spawned, so a host that cannot contain what this
  // kind is owed refuses rather than running it uncontained. This is #32's
  // error, on the path that actually starts code.
  assertIsolationAvailable(required, support);

  const plain: ContainedCommand = { executable: request.executable, args: request.args };

  // A kind that needs nothing is not wrapped just because a backend happens to
  // exist — that is the `tool` row, and it is what keeps the snapshot system's
  // `git` calls working.
  if (required === "in-process") return plain;

  const backend = support.backend;
  if (backend === undefined) return plain;
  if (!satisfiesIsolation(backend.level, required)) return plain;

  return backend.contain({
    policy: request.policy,
    executable: request.executable,
    args: request.args,
    cwd: request.cwd,
    network: request.network,
    ...(request.lineJoin === undefined ? {} : { lineJoin: request.lineJoin }),
    ...(request.programRoots === undefined ? {} : { programRoots: request.programRoots }),
  });
}
