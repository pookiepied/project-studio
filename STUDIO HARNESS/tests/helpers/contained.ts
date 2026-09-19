import { it } from "vitest";

import { measuredIsolation, preferIsolation } from "../../src/sandbox/isolation/index.js";

/**
 * For tests that need this machine to be able to contain a child.
 *
 * ## Why a shared helper rather than a check in each file
 *
 * A test about the fence is a test about the machine as much as about the
 * code, and there are several such files. Since ADR 0057 the fence is the
 * person's to turn on, so this helper turns it on for the test process
 * wherever the machine can supply it - the tests that want the fence get
 * it, and on a machine that cannot supply it they are skipped rather than
 * run against a gate-only sandbox that would pass for the wrong reason.
 *
 * This is not hypothetical. Stock **Ubuntu 24.04** has bubblewrap installed and
 * still refuses the user namespace to unprivileged programs
 * (`kernel.apparmor_restrict_unprivileged_userns=1` with no AppArmor profile
 * granting `userns create`). Measured, not read. On that machine the shell tool
 * correctly refuses, and a suite that asserts the shell tool's *output* has
 * nothing to say.
 *
 * ## Skipped, never quietly passed
 *
 * `describe.skip` reports the file as skipped rather than green. A suite that
 * says "passed" on a host where the feature could not be exercised is the same
 * class of untrue claim this whole remediation cycle exists to remove — and it
 * is exactly what a `try/catch` around the refusal would produce.
 *
 * The counterpart is that the *refusal* is asserted too, in
 * `tests/integration/sandbox-bwrap.test.ts`, on the machines that produce it.
 * Between them the two states are covered: nothing is skipped everywhere.
 */

/** True when this host has a backend that its own probe says works. */
export const CAN_CONTAIN: boolean = measuredIsolation().backend !== undefined;

// The fence on, for this process, wherever it can be had. A test about the
// fence reads `hostIsolation()` through `LocalSandbox`'s default, and that
// answers "none" until someone wants the fence.
if (CAN_CONTAIN) preferIsolation(true);

/**
 * True when this host can run a model-chosen program at all. Always, since
 * ADR 0057: a host that cannot fence runs the program under the gate, so no
 * state refuses. Kept as a name so the tests that start a program still say
 * which property they depend on.
 */
export const CAN_RUN = true;

/** `it`, unless containment is unavailable here - for tests about the fence. */
export const itContained = CAN_CONTAIN ? it : it.skip;

/** `it`, unless nothing can run here - for tests that start a program. */
export const itRuns = CAN_RUN ? it : it.skip;
