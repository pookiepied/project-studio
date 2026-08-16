/**
 * Whose ability to do something is being measured.
 *
 * Its own module because two probes need it — `bwrap`'s and `pasta`'s — and
 * because it is not a fact about either program. It is the answer to a question
 * that turns out to be easy to get wrong: *who* is this measurement about.
 */
export interface ProbeIdentity {
  readonly uid: number;
  readonly gid: number;
}

/**
 * The unprivileged account whose answer a setup command actually needs.
 *
 * `nobody` on every distribution that ships one, and the point is that the
 * *number* barely matters: the AppArmor restriction is attached to the program,
 * not to the person, so any account without `CAP_SYS_ADMIN` returns the same
 * verdict. This is the stand-in for "somebody who is not root" when there is no
 * real candidate to name.
 */
const NOBODY: ProbeIdentity = { uid: 65_534, gid: 65_534 };

/**
 * Who a *setup* command must ask about, which is rarely the process asking.
 *
 * Root creates user namespaces whatever the kernel's restriction says — it holds
 * `CAP_SYS_ADMIN`, and AppArmor's `userns` rule never applies to it. So `sudo
 * pnpm sandbox:prepare` probing itself measures the one account on the machine
 * whose answer does not matter, concludes the sandbox already works, and exits
 * without installing anything. Measured on Ubuntu 24.04: the same `bwrap`
 * command fails for the user and succeeds under `sudo`.
 *
 * That is not a rough edge, it is the failure this seam exists to prevent,
 * wearing the setup command as a disguise: containment reported as working while
 * every contained thing the user runs is refused.
 *
 * Pure in its arguments so the mapping can be asserted on any platform — the
 * caller supplies `process.getuid?.()` and `process.env`. `undefined` means
 * "measure yourself", which is right whenever the asker is already unprivileged.
 */
export function unprivilegedIdentity(
  uid: number | undefined,
  env: NodeJS.ProcessEnv,
): ProbeIdentity | undefined {
  if (uid !== 0) return undefined;

  // `sudo` names the person who invoked it, and they are exactly who will run
  // Studio afterwards. Preferred over `nobody` because a machine could in
  // principle confine that one account further, and the answer they get should
  // be the answer about them.
  const sudoUid = Number(env["SUDO_UID"]);
  const sudoGid = Number(env["SUDO_GID"]);
  if (Number.isInteger(sudoUid) && sudoUid > 0) {
    return {
      uid: sudoUid,
      gid: Number.isInteger(sudoGid) && sudoGid > 0 ? sudoGid : sudoUid,
    };
  }
  return NOBODY;
}

/**
 * The `execFileSync` options that run a probe as somebody else.
 *
 * Dropping to a non-zero uid drops the capabilities with it, which is the whole
 * reason this works: the child becomes unprivileged in the way that makes the
 * kernel's restriction apply. `uid` and `gid` are set together or not at all —
 * `gid` cannot be changed after `uid`, so a missing `gid` would leave the child
 * in root's group.
 */
export function asIdentity(identity: ProbeIdentity | undefined): {
  uid?: number;
  gid?: number;
} {
  return identity === undefined ? {} : { uid: identity.uid, gid: identity.gid };
}
