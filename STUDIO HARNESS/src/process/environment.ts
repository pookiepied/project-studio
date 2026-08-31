/**
 * What a child process is allowed to inherit — for every child, in one place.
 *
 * Project Studio starts three kinds of child, and they are not the same kind of
 * trust. Before this module each spawn site decided for itself, which is how the
 * desktop Host ended up handing the Harness the entire host environment with a
 * `// For now` comment on it (meta-task #74) while, two layers down, the tool
 * runner was refusing to inherit even `PATH`. Two opposite answers to one
 * question, each locally reasonable, neither aware of the other.
 *
 * So the kinds are named here and nowhere else. A new spawn site picks one; it
 * does not invent a fourth.
 *
 * | Kind | Who starts it | Policy |
 * |---|---|---|
 * | **Harness** | the desktop Host (Rust) | `HARNESS_INHERITED_VARIABLES` — an allowlist. It is first-party code that has to resolve real binaries, so it keeps `PATH` and a home directory. |
 * | **Tool** | the Harness | `buildEnvironment()` — OS plumbing only, `PATH` blanked. |
 * | **MCP server** | the Harness | `buildEnvironment(declared)` — the same, plus exactly what the server's own record declares. |
 *
 * The single rule underneath all three: **an environment is built from a stated
 * policy, never copied from `process.env`.** A denylist cannot work here — it
 * has to enumerate every secret anyone might ever export, and it is wrong the
 * first time someone invents a new one. An allowlist is wrong in the direction
 * that gets noticed: something fails to start and says so.
 *
 * ADR 0039 records the decision. The Rust half lives in
 * `STUDIO/src-tauri/src/harness/environment.rs`, and
 * `tests/unit/harness-environment-parity.test.ts` fails if the two lists stop
 * agreeing — the same guard as the duplicated git lists in #78, for the same
 * reason: the copies are each internally consistent, so drift is silent.
 */

/**
 * Variables Windows binaries need in order to start at all.
 *
 * This is the single, deliberate exception to building from policy. Without
 * `SystemRoot` many Windows executables fail to initialise the socket and
 * crypto layers; without a temp directory git cannot write its index lock. The
 * list is OS plumbing, and nothing here can carry a credential.
 *
 * `PATH` is absent from this list and then **explicitly blanked** in
 * `buildEnvironment`, which is not the same thing — see the comment there.
 *
 * `PATHEXT` is here and `PATH` is not, and the difference is the whole point:
 * `PATH` says *where* a child may look for programs, which is reach and
 * belongs to policy; `PATHEXT` says which file extensions count as executable
 * on this OS, which is spelling. Without it a Windows shell handed a perfectly
 * good `PATH` still cannot run `node`, because it never tries `node.exe` —
 * measured, as "The term 'node' is not recognized", from a contained shell
 * whose PATH was granted and correct. It grants nothing on its own: a child
 * with no `PATH` and every extension in the world can still reach nothing.
 */
export const OS_REQUIRED_VARIABLES = [
  "SystemRoot",
  "windir",
  "TEMP",
  "TMP",
  "PATHEXT",
] as const;

/**
 * What the desktop Host passes through to the Harness.
 *
 * Every entry is here because something measurably reads it. The list was built
 * by enumerating `process.env` reads across `src/`, not by guessing what a Node
 * process might want:
 *
 * - **`PATH`** — `vendor/resolver.ts:171` and `tools/shell/resolve.ts:127`
 *   resolve real binaries through it. The Harness cannot find git or ripgrep
 *   without it. This is the one entry that grants reach, and it is the reason
 *   the Harness is a different kind of child from the tools it starts: it is
 *   first-party code whose job includes finding programs, and the containment
 *   that matters for the programs it finds is applied to *them* (`buildEnvironment`).
 * - **Home directory** — `platform/paths.ts:60` calls `homedir()`, which reads
 *   `HOME` on Unix and `USERPROFILE`/`HOMEDRIVE`/`HOMEPATH` on Windows. Without
 *   it there is no `~/.studio`, so no database, no snapshots, no vendor
 *   directory.
 * - **OS plumbing** — the same four as above, for the same reasons.
 * - **Locale** — `LANG`/`LC_ALL` only affect how child output is decoded. Cheap
 *   to pass, and dropping them silently changes text handling.
 *
 * **What is deliberately absent is the point of the list.** Not here: every API
 * key, cloud credential, CI token and provider secret a developer has exported
 * into the shell that launched the desktop app. Also not here, specifically:
 *
 * - `PROJECT_STUDIO_ADMISSION_CREDENTIAL` — the per-launch credential travels
 *   over a file descriptor precisely so it never appears in an environment
 *   (008.5). Passing it here would undo that in one line.
 * - `NODE_OPTIONS` — it carries `--require`, which is arbitrary code execution
 *   in the Harness process before any of our code runs. An inherited
 *   `NODE_OPTIONS` is a remote-controlled preload, and nothing we do afterwards
 *   would see it happen.
 *
 * The Host sets `PORT`, `PROJECT_STUDIO_HARNESS_HOSTNAME` and the two FD
 * variables explicitly. Those are supplied, not inherited, so they are not on
 * this list.
 */
export const HARNESS_INHERITED_VARIABLES = [
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "PATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "windir",
] as const;

/**
 * Builds the environment for a tool or MCP child.
 *
 * Exported so tests can assert the OS exception above stays an exception.
 */
export function buildEnvironment(
  supplied: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const name of OS_REQUIRED_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }

  // Windows hands a child `PATH` whether or not we pass one. Measured, not
  // assumed: spawning with `env: {}` still delivers PATH, USERPROFILE,
  // USERNAME, HOMEDRIVE, HOMEPATH, LOGONSERVER, and USERDOMAIN, because libuv
  // merges a set of variables the platform treats as mandatory.
  //
  // Leaving it there would make this module's central claim false — a spawned
  // binary could resolve any tool on the machine, which is the exact thing
  // building an environment from policy is meant to prevent. An explicitly
  // empty value does override the injected one, so it is set rather than
  // omitted. Omission is not refusal on this platform.
  //
  // The other injected variables are left alone: they name the user rather
  // than granting reach, and blanking a home directory breaks programs for no
  // security gain.
  environment.PATH = "";

  // The caller's policy wins, so a policy that pins TEMP is honoured rather
  // than silently overwritten by the host's.
  return { ...environment, ...supplied };
}
