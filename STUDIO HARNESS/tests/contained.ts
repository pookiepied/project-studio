import { describe, it } from "vitest";

import { hostIsolation } from "../src/sandbox/isolation/index.js";

/**
 * For tests that need this machine to be able to contain a child.
 *
 * ## Why a shared helper rather than a check in each file
 *
 * Once a platform registers a backend, it *enforces*: a host that cannot supply
 * the containment a `shell` command is owed refuses the command rather than
 * running it open. That is the whole of meta-task #15 and it is working as
 * intended — but it means every test that runs a real program is now a test
 * about the machine as much as about the code, and there are several such
 * files.
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
export const CAN_CONTAIN: boolean = hostIsolation().backend !== undefined;

/** `describe`, unless containment is unavailable here. */
export const describeContained = CAN_CONTAIN ? describe : describe.skip;

/** `it`, unless containment is unavailable here. */
export const itContained = CAN_CONTAIN ? it : it.skip;
