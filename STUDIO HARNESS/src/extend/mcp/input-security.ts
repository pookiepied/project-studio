import { ExtendError } from "../errors.js";

const SECRET_FIELD =
  /(?:^|[_-])(api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|passwd|secret|token)(?:$|[_-])/i;
const SECRET_ARGUMENT =
  /^(?:--?)(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|passwd|secret|token)(?:=|$)/i;
const NON_SECRET_AUTH_FIELDS = new Set(["auth", "authHeader", "authEnvVar"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSecretFieldName(name: string): boolean {
  return SECRET_FIELD.test(name);
}

function reject(): never {
  throw new ExtendError("internal", {
    message: "Secrets are entered through the credential endpoint, not server configuration.",
  });
}

function inspect(value: unknown, path: readonly string[]): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      if (path.at(-1) === "args" && typeof entry === "string" && SECRET_ARGUMENT.test(entry)) {
        reject();
      }
      inspect(entry, [...path, String(index)]);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    // authEnvVar is a variable-name reference, not a secret value.
    if (!NON_SECRET_AUTH_FIELDS.has(key) && isSecretFieldName(key)) reject();
    inspect(entry, [...path, key]);
  }
}

/** Rejects secret-shaped fields at every nesting level before projection. */
export function assertSafeMcpPayload(value: unknown): void {
  inspect(value, []);
}

/** Query strings are configuration too; secret-bearing names cannot be durable. */
export function assertSafeMcpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.username !== "" || parsed.password !== "") reject();
  for (const key of parsed.searchParams.keys()) {
    if (isSecretFieldName(key)) reject();
  }
}

/**
 * The longest a server's purpose sentence may be.
 *
 * It is one sentence, and a generous reading of one sentence is a couple of
 * lines. The number is not about tidiness: this text is copied verbatim into
 * the capability inventory, which sits in the system block, which is the most
 * trusted position in the prompt and is paid for on every turn. Without a cap
 * a server could spend a thousand tokens of that position on whatever it
 * liked, on every request, for as long as it stayed installed.
 */
export const MCP_DESCRIPTION_LIMIT = 300;

/**
 * Characters that are not text, refused before the sentence is stored.
 *
 * A newline is the one that matters. The inventory renders one server per
 * line; a description carrying a line break could open what looks like a new
 * section, and a section in the system block is the voice the model trusts
 * most. Refusing the character is the fix, because escaping it at every
 * renderer is a rule that only has to be forgotten once.
 *
 * The tab is refused with them rather than allowed: nothing legitimate in a
 * one-sentence purpose needs one, and a permitted whitespace character is one
 * more thing a layout can be built from.
 */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Refuses a purpose sentence that could not honestly be one.
 *
 * Refused at the moment it is written rather than trimmed at the moment it is
 * rendered. Trimming would leave the row holding something no reader expected
 * and would put the guard in however many places one day render it; refusing
 * puts the message in front of the person who typed it, and leaves exactly one
 * shape in the database. The inventory still caps and strips what it renders,
 * because a row can also arrive from a database written by hand.
 */
export function assertSafeMcpDescription(description: string): void {
  if (description.length > MCP_DESCRIPTION_LIMIT) {
    throw new ExtendError("internal", {
      message: `A server description must be one sentence, at most ${MCP_DESCRIPTION_LIMIT} characters.`,
    });
  }
  if (CONTROL_CHARACTER.test(description)) {
    throw new ExtendError("internal", {
      message: "A server description must be a single line of plain text.",
    });
  }
}

/** Defense in depth for records written without the HTTP adapter. */
export function assertSafeMcpRecord(input: {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly description?: string;
}): void {
  assertSafeMcpPayload({ args: input.args ?? [], env: input.env ?? {} });
  if (input.url !== undefined) assertSafeMcpUrl(input.url);
  if (input.description !== undefined) assertSafeMcpDescription(input.description);
}
