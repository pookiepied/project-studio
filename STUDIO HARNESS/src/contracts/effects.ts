import type { CapabilityDescriptor, CapabilityEffect } from "./capabilities.js";

/**
 * What each effect requires. One table, and the only place that answers.
 *
 * ## Why this file exists
 *
 * Six places used to read `descriptor.effects`, and each one held its own rule
 * inline: trust checked for `read`, the mode checked for `read` or `write`, the
 * sandbox mapped each effect to an isolation level, and the gate checked for
 * `write` before taking a snapshot. Six copies of one idea, and nothing
 * compared them.
 *
 * They disagreed, and the disagreement shipped. `shell` declares `execute`.
 * Five readers handled it correctly. The sixth looked for `write`, did not find
 * it, and took no snapshot — so a program the model ran could rewrite the
 * project with nothing to return to. That is `T-14`, and the same shape
 * produced `K-04`.
 *
 * The lesson is not that the layers are wrong. It is that a meaning kept in six
 * places is a meaning that will differ in at least one of them. So the meaning
 * lives here, once, and every reader looks it up.
 *
 * ## How to change it
 *
 * Add an effect: add a row, and answer all four columns. Nothing else changes,
 * and the compiler names every reader if the shape moves.
 *
 * Keep the table small. A table with twenty columns is the problem it replaced,
 * wearing a different name.
 */

/**
 * How strongly a sandbox isolates.
 *
 * A claim a provider makes about itself, which is what lets the harness refuse
 * work needing isolation it does not have — rather than running the work anyway
 * and calling the result sandboxed.
 */
export type IsolationLevel =
  /**
   * In-process enforcement only: paths are checked, ambient environment is
   * withheld. Effective against an agent that goes off-track. Not a boundary
   * against code that is actively hostile, because anything reaching a real
   * subprocess is outside our checks.
   */
  | "in-process"
  /** OS-level isolation: separate kernel or supervised namespace. */
  | "os"
  /** Hardware isolation on another machine. */
  | "remote-vm";

export interface EffectRule {
  /**
   * The isolation this effect needs before we may honestly admit it.
   *
   * `execute` cannot be contained from inside our own process: once a
   * subprocess exists our path checks are irrelevant to it, and it is the one
   * effect that *always* means a child was started.
   *
   * `network` used to say `os` for the second half of that sentence — nothing
   * in userspace Node stops a subprocess opening a socket. True, and it was
   * being asked in the wrong place. A child's network access is now decided
   * where the child is created, by the kernel, from the operator's
   * `allowNetwork` switch: `internetClient` or not on Windows, `--share-net` or
   * not on Linux (ADR 0041). Asking again here only reached capabilities that
   * *do not start a child at all* — our own `web_fetch`, which makes an HTTPS
   * request from the harness process — and refused them because a sandbox for
   * somebody else's subprocess was unavailable.
   *
   * That is the second taxonomy ADR 0041 was written to prevent, arriving from
   * the other direction: containment is a property of the **kind** of child, in
   * `isolation/kinds.ts`, and this table describes what an effect needs of the
   * harness. It surfaced on stock Ubuntu 24.04, the first host ever measured
   * that registers a backend and cannot run it — on every earlier machine the
   * two answers happened to coincide.
   */
  readonly isolation: IsolationLevel;
  /**
   * Whether a restore point must exist before this runs.
   *
   * True for `write`, which changes files we can name. Also true for
   * `execute`, and that is the correction `T-14` forced: a program we did not
   * write may change anything, so "we cannot know what it touched" is the
   * honest state. It is the same fact as "we did not choose this program", and
   * it deserves the same answer — a point to return to.
   *
   * False for `network`. A request leaves the machine; it does not change the
   * project on the way out. What comes *back* is a different problem, and a
   * snapshot is not the tool for it. See `C-10`.
   */
  readonly undo: boolean;
  /**
   * Whether this effect is never granted silently, whatever a grant says.
   *
   * Running code and reaching the network are the two a user must be asked
   * about at least once, no matter how the call arrived.
   */
  readonly elevated: boolean;
  /**
   * Whether this effect is allowed in a folder the user has not trusted.
   *
   * Only reading. A harness that refuses to open a folder until it is trusted
   * cannot help anyone decide whether to trust it, and "let me look at this
   * repository first" is the normal reason the question is asked at all.
   * Everything else turns someone else's repository into an instruction our
   * machine follows.
   */
  readonly safeUntrusted: boolean;
}

export const EFFECT_RULES: Readonly<Record<CapabilityEffect, EffectRule>> = {
  read: {
    isolation: "in-process",
    undo: false,
    elevated: false,
    safeUntrusted: true,
  },
  write: {
    isolation: "in-process",
    undo: true,
    elevated: false,
    safeUntrusted: false,
  },
  execute: {
    isolation: "os",
    undo: true,
    elevated: true,
    safeUntrusted: false,
  },
  network: {
    // See `EffectRule.isolation`. Not a relaxation: a contained child's network
    // is granted or withheld by the kernel at creation, which is stronger than
    // this check ever was. `allowNetwork` is still asked, immediately above the
    // isolation branch in `LocalSandbox.assertSupports`.
    isolation: "in-process",
    undo: false,
    elevated: true,
    safeUntrusted: false,
  },
};

/** The isolation an effect requires. */
export function requiredIsolation(effect: CapabilityEffect): IsolationLevel {
  return EFFECT_RULES[effect].isolation;
}

const ISOLATION_RANK: Record<IsolationLevel, number> = {
  "in-process": 0,
  os: 1,
  "remote-vm": 2,
};

export function satisfiesIsolation(
  provided: IsolationLevel,
  required: IsolationLevel,
): boolean {
  return ISOLATION_RANK[provided] >= ISOLATION_RANK[required];
}

/**
 * Whether a capability may run without a restore point behind it.
 *
 * Asked of the *capability*, not of one effect, because a tool with several
 * effects needs a snapshot if any one of them earns it.
 */
export function requiresUndoPoint(descriptor: CapabilityDescriptor): boolean {
  return descriptor.effects.some((effect) => EFFECT_RULES[effect].undo);
}

/** Whether any effect is one that is never granted silently. */
export function hasElevatedEffect(descriptor: CapabilityDescriptor): boolean {
  return descriptor.effects.some((effect) => EFFECT_RULES[effect].elevated);
}

/**
 * Whether a capability may run in a folder the user has not trusted.
 *
 * Every effect must be safe. A capability with no effects at all passes, which
 * is correct only because it can do nothing; a capability that does something
 * declares it.
 */
export function allowedWhileUntrusted(descriptor: CapabilityDescriptor): boolean {
  return descriptor.effects.every((effect) => EFFECT_RULES[effect].safeUntrusted);
}

/**
 * Whether a capability does nothing but read.
 *
 * The one question that is genuinely about the absence of every other effect
 * rather than about a property of one, so it is phrased that way.
 */
export function isReadOnly(descriptor: CapabilityDescriptor): boolean {
  return descriptor.effects.every((effect) => effect === "read");
}
