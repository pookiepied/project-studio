/**
 * The isolation seam.
 *
 * Four files, and the split is by *question* rather than by size:
 *
 * | File | Answers |
 * |---|---|
 * | `kinds.ts` | which children need containment, and how much |
 * | `backend.ts` | what a containment mechanism must be able to do, and which one this host has |
 * | `registry.ts` | which mechanisms this build knows about, per platform |
 * | `linux/` | the one mechanism this build has, in full |
 *
 * There was a `windows/` directory beside `linux/`, four times its size: a
 * launcher, an identity minted per workspace, permission entries granted and
 * revoked, and a ledger to remember them by. ADR 0057 removed it - the
 * entries it wrote accumulated on the user's disk until the ACLs could hold
 * no more - and on Windows the permission gate is the boundary. Linux needed
 * an argument vector, because the distribution already ships the launcher,
 * and that is the shape a backend should have: a fence around a process,
 * set at start, with nothing to take back afterwards.
 */

export { isolationForKind, type ChildKind } from "./kinds.js";
export { containCommand } from "./contain.js";
export { programRoots } from "./program-roots.js";
export { bwrapArgs, type BwrapInput } from "./linux/bwrap.js";
export { unprivilegedIdentity } from "./linux/identity.js";
export {
  withNarrowedNetwork,
  NETWORK_SETUP,
  PRIVATE_V4,
  PRIVATE_V6,
} from "./linux/network.js";
export {
  assertIsolationAvailable,
  isolationAvailable,
  selectIsolation,
  type ContainedCommand,
  type IsolationBackend,
  type IsolationSupport,
} from "./backend.js";
export {
  hostIsolation,
  ISOLATION_ENFORCED,
  OS_ISOLATION_BACKENDS,
} from "./registry.js";
