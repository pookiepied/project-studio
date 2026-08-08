const KEY_VALUE_SECRET =
  /\b(api[_-]?key|secret|password|token|authorization)\b\s*[:=]\s*["']?([^\s"',;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9]{10,}\b/g;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|credential|cookie/i;

export function redactSensitiveString(value: string): string {
  return value
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(OPENAI_STYLE_KEY, "[REDACTED]")
    .replace(AWS_ACCESS_KEY, "[REDACTED]")
    .replace(KEY_VALUE_SECRET, "$1=[REDACTED]");
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
      result[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactGenAiContent(value);
    }
    return result;
  }

  return content;
}
