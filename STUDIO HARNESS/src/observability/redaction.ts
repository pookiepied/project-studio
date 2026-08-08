import {
  REDACTION_RULES,
  type RedactionRule,
} from "./redaction-rules.js";

/**
 * Applying the redaction catalog.
 *
 * The rules themselves live in `redaction-rules.ts`. This file only decides
 * which of them are active and runs them, so adding a secret shape never means
 * touching this code.
 *
 * Redaction is **always on**. There is no switch that turns all of it off,
 * because a log line that escaped the machine cannot be un-escaped. What is
 * configurable is which rules apply, by id.
 */

/** Field names whose *value* is dropped whole, whatever it looks like. */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|credential|cookie/i;

/**
 * Rules currently applied.
 *
 * Module-level because `redactSensitiveString` is called from the logger and
 * the error contract, which are themselves module-level and reached from
 * everywhere. Threading configuration through every caller would put a
 * parameter on every log call in the harness to change a setting that changes
 * once, at start-up.
 */
let activeRules: readonly RedactionRule[] = REDACTION_RULES.filter(
  (rule) => rule.enabledByDefault,
);

/**
 * Turns rules on or off by id. Anything not named keeps its default.
 *
 * Called once from `initializeObservability`. An unknown id is ignored rather
 * than thrown on: a stale entry in someone's environment must not stop the
 * harness from starting, and the cost of ignoring it is that a rule they wanted
 * off stays on — which fails in the safe direction.
 */
export function configureRedaction(overrides: Readonly<Record<string, boolean>>): void {
  activeRules = REDACTION_RULES.filter(
    (rule) => overrides[rule.id] ?? rule.enabledByDefault,
  );
}

/** Restores the shipped defaults. For tests, and for a clean re-initialize. */
export function resetRedaction(): void {
  activeRules = REDACTION_RULES.filter((rule) => rule.enabledByDefault);
}

/** Which rules are applied right now, for diagnostics and tests. */
export function activeRedactionRuleIds(): readonly string[] {
  return activeRules.map((rule) => rule.id);
}

export function redactSensitiveString(value: string): string {
  let result = value;
  for (const rule of activeRules) {
    // `lastIndex` is per-regex state and these are shared module constants, so
    // a `g` pattern reused across calls would resume mid-string and miss
    // matches. `String.replace` with a `g` pattern resets it, but only on
    // success — resetting here makes it unconditional.
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

export function redactGenAiContent(content: unknown): unknown {
  if (typeof content === "string") {
    return redactSensitiveString(content);
  }

  if (Array.isArray(content)) {
    return content.map((entry) => redactGenAiContent(entry));
  }

  if (content && typeof content === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
      // A field named `password` is dropped whole rather than pattern-matched.
      // The name is stronger evidence than the shape of the value.
      result[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactGenAiContent(value);
    }
    return result;
  }

  return content;
}
