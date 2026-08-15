/**
 * The redaction catalog.
 *
 * ## What this is for
 *
 * Everything that gets removed from a log line, an error message, or a
 * telemetry span is listed here, once. Adding a secret shape means adding an
 * entry to this array and nothing else. Turning one off means naming its `id`
 * in configuration — no code change.
 *
 * ## What this is NOT for
 *
 * These rules never touch what the model sees. They run on the *copy* that goes
 * to logs and telemetry. If a user pastes an API key and asks the agent to use
 * it, the model gets the real key and the tool gets the real key; only the log
 * shows `[REDACTED]`. Deciding what the model may see is context policy, lives
 * in `context/`, and must not be folded in here. That question was `C-12` in
 * `check-later.md`, which no longer exists; it is now carried by the issue
 * register at `documentation/work/phases-1-11-remediation.md`.
 *
 * ## How to turn a rule on or off
 *
 * By id, either in code or from the environment:
 *
 * ```ts
 * initializeObservability({ redactionRules: { email: true } });
 * ```
 *
 * ```
 * PROJECT_STUDIO_REDACTION_RULES="email:on,jwt:off"
 * ```
 *
 * ## How to add a rule
 *
 * Append an entry below. Three requirements:
 *
 * 1. The pattern carries the `g` flag. Without it only the first match in a
 *    line is replaced, and a line usually holds more than one.
 * 2. `enabledByDefault` is `false` unless the value is *always* a secret. A
 *    redactor that eats ordinary text gets switched off entirely, and then
 *    nothing is redacted.
 * 3. `summary` says what the rule catches in one line. It is what a developer
 *    reads when deciding whether to disable it.
 *
 * Order matters: rules run top to bottom, so a broad rule placed first will
 * consume text a narrower one would have labelled better.
 */

export interface RedactionRule {
  /** Stable name used to enable or disable the rule. Never renamed. */
  readonly id: string;
  /** One line: what this catches. */
  readonly summary: string;
  /**
   * Whether the shipped build applies it.
   *
   * `false` means the rule is real but costs more than it gives for most
   * users — usually because it also matches ordinary text.
   */
  readonly enabledByDefault: boolean;
  /** Must be global (`g`), or only the first match on a line is replaced. */
  readonly pattern: RegExp;
  /** May reference capture groups, as `$1`. */
  readonly replacement: string;
}

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: "private-key-block",
    summary: "A PEM private key block, of any key type.",
    enabledByDefault: true,
    // First, because the body of a key block can contain anything and a later
    // rule matching inside it would leave the rest of the key in place.
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    id: "bearer-token",
    summary: "An Authorization header carrying a bearer token.",
    enabledByDefault: true,
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    id: "url-credentials",
    summary: "A username and password embedded in a URL.",
    enabledByDefault: true,
    // The host is kept: knowing which service was reached is most of a log
    // line's value, and it is not the secret.
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi,
    replacement: "$1[REDACTED]@",
  },
  {
    id: "sk-key",
    summary: "An sk- API key, including the segmented Anthropic and project shapes.",
    enabledByDefault: true,
    // Hyphens belong in the body. Without them this stopped at the first
    // segment and `sk-ant-api03-…` passed through in full.
    pattern: /\bsk-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    id: "github-token",
    summary: "A GitHub personal access, OAuth, app, or refresh token.",
    enabledByDefault: true,
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[REDACTED]",
  },
  {
    id: "google-api-key",
    summary: "A Google API key.",
    enabledByDefault: true,
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    replacement: "[REDACTED]",
  },
  {
    id: "slack-token",
    summary: "A Slack bot, user, app, or refresh token.",
    enabledByDefault: true,
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    id: "aws-access-key-id",
    summary: "An AWS access key id.",
    enabledByDefault: true,
    // The matching secret key has no distinctive shape — it is 40 characters of
    // base64 and a pattern for it would match ordinary hashes. It is caught by
    // `key-value-secret` instead, which is why that rule runs last.
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED]",
  },
  {
    id: "jwt",
    summary: "A JSON Web Token, such as a session or access token.",
    enabledByDefault: true,
    // Three base64url segments where the first decodes to a JSON header, which
    // is what `eyJ` is. Specific enough not to match ordinary text.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
    replacement: "[REDACTED]",
  },
  {
    id: "key-value-secret",
    summary: "Any value assigned to a field whose name means a secret.",
    enabledByDefault: true,
    // Last on purpose. It is the widest rule and the catch-all for shapes we
    // have no pattern for, so anything a specific rule could have labelled
    // better has already had its turn.
    pattern:
      /\b(api[_-]?key|secret|password|passphrase|token|credential|authorization)\b\s*[:=]\s*["']?([^\s"',;]+)/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    id: "email",
    summary: "An email address.",
    // Off on purpose. The signed-in user's email is how a support log is tied
    // to a user, and removing it takes away most of what the log is for. It is
    // here so a deployment that must not hold personal data can turn it on in
    // one line.
    enabledByDefault: false,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED EMAIL]",
  },
];

/** Every rule id, for validating configuration against typos. */
export const REDACTION_RULE_IDS: ReadonlySet<string> = new Set(
  REDACTION_RULES.map((rule) => rule.id),
);
