/**
 * The boot log: one line on `process.stderr` per startup phase, as it begins.
 *
 * The harness had a silent window. A child that died between `spawn` and its
 * first log line said nothing on any stream for its whole life, and every
 * diagnostic downstream could only report that nothing was said. The first log
 * line used to belong to the observability logger — which is itself one of the
 * things being started — so the window covered module load, the Flue journal
 * open, and everything else that runs before a logger can exist.
 *
 * This closes it from the other side. The function is dependency-free by rule:
 * it may import nothing but Node built-ins, because anything it imported would
 * be back inside the window it exists to describe. It writes to
 * `process.stderr` directly rather than to a logger for the same reason, and
 * the lines are prefixed `[harness-boot]` so they are greppable apart from the
 * structured logs that follow them.
 *
 * Monotonic timestamps only: `Date.now()` steps backwards under NTP and says
 * nothing about ordering inside one boot.
 */

const BOOT_EPOCH = performance.now();

export function bootLog(phase: string): void {
  const elapsed = (performance.now() - BOOT_EPOCH).toFixed(1);
  process.stderr.write(`[harness-boot +${elapsed}ms] ${phase}\n`);
}
