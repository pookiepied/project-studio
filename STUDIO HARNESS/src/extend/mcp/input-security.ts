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

/** Defense in depth for records written without the HTTP adapter. */
export function assertSafeMcpRecord(input: {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
}): void {
  assertSafeMcpPayload({ args: input.args ?? [], env: input.env ?? {} });
  if (input.url !== undefined) assertSafeMcpUrl(input.url);
}
