export type ConnectorArtifactFamily =
  | "connector_record"
  | "connector_action"
  | "file"
  | "structured_data"
  | "research"
  | "activity";

export interface ConnectorArtifactProposal {
  presentation_intent: ConnectorArtifactFamily;
  title: string;
  summary: string;
  fields?: Record<string, unknown>;
}

interface ConnectorContext {
  slug: string;
  toolName: string;
  result: unknown;
  policyEffect?: "none" | "read" | "write" | "destructive";
}

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|authorization|cookie|api[_-]?key|refresh[_-]?token|access[_-]?token)/i;

export function connectorArtifactProposal({
  slug,
  toolName,
  result,
  policyEffect,
}: ConnectorContext): ConnectorArtifactProposal {
  const normalizedSlug = slug.toLowerCase();
  const app = appFromToolName(toolName);
  const data = extractData(result);
  const fields = summarizeFields(data);

  if (policyEffect === "write" || policyEffect === "destructive" || mutatingSlug(normalizedSlug)) {
    return {
      presentation_intent: "connector_action",
      title: titleFromParts(app, actionLabel(normalizedSlug), "Connector action"),
      summary: textSummary(data) ?? "The connector action completed.",
      fields,
    };
  }

  if (fileSlug(normalizedSlug, data)) {
    return {
      presentation_intent: "file",
      title: titleFromParts(app, objectTitle(data), "Connector file"),
      summary: textSummary(data) ?? "A file or document was returned by the connector.",
      fields,
    };
  }

  if (searchSlug(normalizedSlug)) {
    return {
      presentation_intent: "research",
      title: titleFromParts(app, "Search results", "Connector search"),
      summary: textSummary(data) ?? "Connector search results were returned.",
      fields,
    };
  }

  if (recordSlug(normalizedSlug, data)) {
    return {
      presentation_intent: "connector_record",
      title: titleFromParts(app, objectTitle(data), "Connector record"),
      summary: textSummary(data) ?? "A connector record was returned.",
      fields,
    };
  }

  return {
    presentation_intent: "structured_data",
    title: titleFromParts(app, actionLabel(normalizedSlug), "Connector result"),
    summary: textSummary(data) ?? "Structured connector data was returned.",
    fields,
  };
}

export function redactConnectorResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConnectorResult);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactConnectorResult(item);
    }
  }
  return output;
}

function extractData(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  return record.data ?? record.result ?? result;
}

function summarizeFields(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const redacted = redactConnectorResult(data);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return undefined;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted as Record<string, unknown>).slice(0, 12)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[key] = value;
    } else if (Array.isArray(value)) {
      fields[key] = `${value.length} items`;
    } else {
      fields[key] = "object";
    }
  }
  return Object.keys(fields).length ? fields : undefined;
}

function textSummary(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return typeof data === "string" ? truncate(data, 220) : undefined;
  }
  const record = data as Record<string, unknown>;
  for (const key of ["summary", "snippet", "description", "subject", "title", "name", "message", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return truncate(value.trim(), 220);
  }
  return undefined;
}

function appFromToolName(toolName: string): string | undefined {
  const match = toolName.match(/^composio_([^_]+)__/) ?? toolName.match(/^([^._:]+)[._:]/);
  return match?.[1]?.replaceAll("-", " ");
}

function actionLabel(slug: string): string {
  return slug.replace(/^.+\./, "").replaceAll("_", " ").replaceAll("-", " ");
}

function titleFromParts(app: string | undefined, detail: string | undefined, fallback: string): string {
  const pieces = [app, detail].filter(Boolean).map((item) => item!.trim()).filter(Boolean);
  if (!pieces.length) return fallback;
  return pieces.map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1)).join(": ");
}

function objectTitle(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["title", "name", "subject", "filename", "fileName", "displayName"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function mutatingSlug(slug: string): boolean {
  return /\b(create|send|update|delete|remove|archive|move|invite|schedule|reply|post|upload)\b/.test(slug);
}

function searchSlug(slug: string): boolean {
  return /\b(search|find|list|query)\b/.test(slug);
}

function fileSlug(slug: string, data: unknown): boolean {
  if (/\b(file|document|drive|attachment|upload|download)\b/.test(slug)) return true;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return ["mimeType", "mime_type", "filename", "fileName", "downloadUrl", "webViewLink"].some((key) => key in data);
}

function recordSlug(slug: string, data: unknown): boolean {
  if (/\b(get|retrieve|read|fetch)\b/.test(slug)) return true;
  return Boolean(objectTitle(data));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
