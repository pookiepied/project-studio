/**
 * Which Node the project requires, and which one it is actually running on.
 *
 * Three numbers described this project's runtime and no two of them agreed
 * (meta-task #79). `.node-version` pinned `24.14.0`. `package.json` declared
 * `engines.node: ">=22.19.0"`. The machine every baseline in the Stage 4 cycle
 * was measured on ran `v22.18.0` — below the floor, two majors below the pin.
 *
 * None of the three was enforced by anything. There is no CI in this
 * repository, and no version manager installed on the development machine, so
 * `.node-version` was read by nobody and `engines` produced a pnpm warning that
 * scrolled past on every install. A claim nothing checks is decoration, and it
 * had already gone stale once (`documentation/archive/KNOWN-ISSUES.md`, E-01,
 * still Open).
 *
 * ## Why the floor is not negotiable
 *
 * The obvious cheap fix — lower the numbers until they match the machine — is
 * closed off by measurement. `>=22.19.0` is not a preference we chose; it is
 * the floor our own dependencies declare:
 *
 * ```
 * @flue/runtime        >=22.19.0
 * @flue/sdk            >=22.19.0
 * @flue/vite           >=22.19.0
 * @flue/opentelemetry  >=22.19.0
 * @earendil-works/pi-ai >=22.19.0
 * ```
 *
 * Flue is the substrate the Harness is built on. Declaring a lower floor than
 * the thing we import would be a statement about our own code that our
 * dependency tree contradicts. So the runtime moves up; the numbers do not move
 * down. {@link MINIMUM_NODE_VERSION} is bound to those declarations by
 * `tests/unit/runtime-version.test.ts`, which reads the installed packages
 * rather than trusting this comment.
 *
 * ## Why it is stated here rather than read from `package.json`
 *
 * `vite build` bundles the Harness to `dist/server.mjs` plus its chunks,
 * and `package.json` is not reliably beside it at runtime. The same shape as the
 * environment allowlist (ADR 0039): the value is a constant in the module that
 * needs it, and a test binds the copies together. Each copy is internally
 * consistent, so drift is silent unless something checks — which is exactly how
 * #79 survived a full remediation cycle.
 */

/**
 * The lowest Node the Harness may run on.
 *
 * Not a target and not an aspiration — the point below which a dependency has
 * told us it does not support the runtime. Raising it is a decision; lowering it
 * requires that the dependencies lowered theirs first.
 */
export const MINIMUM_NODE_VERSION = "22.19.0";

/**
 * The version the project develops and verifies on — the `.node-version` pin.
 *
 * `24.19.0` is the current patch of the Krypton LTS line (released 2026-08-03),
 * which is the line the pin already named. The pin was `24.14.0`, the same line
 * five patches back, set when the repository was created and never revisited.
 * Moving to the current patch of the line the project already chose keeps the
 * intent and drops the staleness; it is not a change of Node major.
 *
 * A pin below {@link MINIMUM_NODE_VERSION} would be incoherent, and the test
 * suite fails if that ever happens.
 */
export const DEVELOPMENT_NODE_VERSION = "24.19.0";

export interface RuntimeVerdict {
  /** False when the running version is below {@link MINIMUM_NODE_VERSION}. */
  readonly supported: boolean;
  /** The running version, without the `v`. */
  readonly running: string;
  readonly minimum: string;
  /**
   * Present only when `supported` is false. Written to be actionable on its own
   * — it names both versions, because "unsupported Node" without the numbers
   * sends the reader to look them up.
   */
  readonly message?: string;
}

/**
 * Orders two dotted release numbers.
 *
 * Deliberately not semver-complete: Node releases are `major.minor.patch` with
 * no pre-release tags on any version this project can be pinned to, and pulling
 * in a range parser to compare four integers would be the larger cost. Anything
 * unparsable sorts as `0`, so a malformed version is treated as *older* and
 * therefore reported rather than waved through.
 */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string): number[] =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));

  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Answers whether a runtime is one the project supports.
 *
 * Takes the version as an argument so the unsupported branch is testable
 * without a second Node installed — the failure this exists to report is one we
 * cannot reproduce by running the suite, which is the same reason it went
 * unreported for a whole cycle.
 */
export function checkNodeRuntime(version: string = process.version): RuntimeVerdict {
  const running = version.replace(/^v/, "");
  const supported = compareVersions(running, MINIMUM_NODE_VERSION) >= 0;
  if (supported) return { supported, running, minimum: MINIMUM_NODE_VERSION };

  return {
    supported,
    running,
    minimum: MINIMUM_NODE_VERSION,
    message:
      `Node ${running} is below the ${MINIMUM_NODE_VERSION} required by this ` +
      `project's dependencies. Install Node ${DEVELOPMENT_NODE_VERSION} (the ` +
      `pinned version in .node-version). Results measured on this runtime are ` +
      `not evidence about the supported one.`,
  };
}

/**
 * Reports the verdict once, at startup, through whatever the caller logs with.
 *
 * A warning rather than a refusal to start, on purpose. Node below the floor is
 * a fact about the developer's machine, not corruption of the user's data, and
 * a Harness that refuses to boot removes the operator's ability to read the
 * message telling them why. It is loud and it is on every start, which is the
 * property `.node-version` never had.
 */
export function reportNodeRuntime(
  logger: { warn: (message: string, attributes?: Record<string, unknown>) => void },
  version: string = process.version,
): RuntimeVerdict {
  const verdict = checkNodeRuntime(version);
  if (!verdict.supported) {
    logger.warn(verdict.message ?? "Unsupported Node runtime", {
      running: verdict.running,
      minimum: verdict.minimum,
      pinned: DEVELOPMENT_NODE_VERSION,
    });
  }
  return verdict;
}
