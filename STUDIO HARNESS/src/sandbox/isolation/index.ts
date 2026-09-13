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
 * | `linux/` | the other one, in full |
 *
 * The two platform directories are deliberately not symmetrical in size.
 * Windows needed a launcher written, an identity minted and permission entries
 * granted and revoked; Linux needed an argument vector, because the distribution
 * already ships the launcher. Forcing them into the same shape would be
 * inventing work to make a diagram tidy.
 */

export { isolationForKind, type ChildKind } from "./kinds.js";
export { containCommand } from "./contain.js";
export { programRoots } from "./program-roots.js";
export { invokeLauncher } from "./windows/launcher.js";
export { bwrapArgs, type BwrapInput } from "./linux/bwrap.js";
export { unprivilegedIdentity } from "./linux/identity.js";
export {
  withNarrowedNetwork,
  NETWORK_SETUP,
  PRIVATE_V4,
  PRIVATE_V6,
} from "./linux/network.js";
export {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  grantCorridor,
  holdsRead,
  holdsCorridor,
} from "./windows/traversal.js";
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
