/**
 * The permission name of a program the shell runs.
 *
 * This file used to resolve the program the model named, and to refuse
 * `.cmd`, `.bat`, and `.ps1` shims - `npm`, `pnpm`, `yarn`, and `tsc` could
 * not run at all on Windows. ADR 0046 inverted that: the tool takes a command
 * line, an interpreter chosen in `src/process/interpreter.ts` runs it, and
 * what is approved is the *name* of every program the line starts, read by
 * `command.ts`. The resolver's job - and with it the shim refusal, tracked as
 * `T-13` - is gone; `npm` runs because the shell runs it.
 */

/** `shell:npm`. Matches the `git:push` shape so one rule syntax covers both. */
export function shellResource(name: string): string {
  return `shell:${name.toLowerCase()}`;
}
