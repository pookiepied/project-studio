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
 * | `windows/` | one mechanism, in full |
 *
 * A `linux/` directory appears in Stage 4b step 3 and holds `bwrap`. It is
 * absent rather than empty on purpose: a directory that promises an
 * implementation nobody has written is the same lie as a comment that says
 * "TODO: contain this".
 */

export { isolationForKind, type ChildKind } from "./kinds.js";
export { containCommand, type ContainRequest } from "./contain.js";
export { programRoots } from "./program-roots.js";
export {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  ensureTraversable,
  grantTraverse,
  holdsTraverse,
} from "./windows/traversal.js";
export {
  assertIsolationAvailable,
  isolationAvailable,
  selectIsolation,
  type ContainedCommand,
  type ContainmentRequest,
  type IsolationBackend,
  type IsolationSupport,
} from "./backend.js";
export {
  hostIsolation,
  ISOLATION_ENFORCED,
  OS_ISOLATION_BACKENDS,
} from "./registry.js";
