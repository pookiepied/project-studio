import type { DiagnosticCaptureHandle, DiagnosticValue } from "../contracts/diagnostics.js";
import { redactSensitiveString } from "./redaction.js";
import { types } from "node:util";

const SECRET = /pass(word)?|secret|authorization|api[_-]?key|credential|cookie|token|^env(ironment)?$/i;
const TOKEN_COUNT = new Set([
  "totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "maxTokens",
  "max_tokens", "max_output_tokens", "max_completion_tokens", "maxOutputTokens", "inputTokenLimit", "outputTokenLimit",
  "input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens", "cached_tokens",
  "reasoning_tokens", "audio_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens",
  "cache_read_input_tokens", "cache_creation_input_tokens", "promptTokenCount", "candidatesTokenCount",
  "cachedContentTokenCount", "thoughtsTokenCount", "totalTokenCount",
]);
const OMITTED = "[omitted]";
const MAX_CAPTURE_BIGINT = (1n << 4096n) - 1n;
const serializedSources = new WeakMap<object, string>();
const projectedSources = new WeakMap<object, { readonly value: unknown; readonly fields: readonly string[] }>();
const indexedSources = new WeakMap<object, { readonly value: unknown; readonly keys: (value: object) => readonly PropertyKey[] | undefined }>();

/** Reuse a bounded key index supplied by the source's existing snapshot work. */
export function diagnosticIndexedContent(value: unknown, keys: (value: object) => readonly PropertyKey[] | undefined): DiagnosticCaptureHandle {
  const handle = Object.freeze({}) as DiagnosticCaptureHandle;
  indexedSources.set(handle, { value, keys });
  return handle;
}

/** A source-owned vocabulary. Unknown object properties are never enumerated. */
export function diagnosticProjectedContent(value: unknown, fields: readonly string[]): DiagnosticCaptureHandle {
  const handle = Object.freeze({}) as DiagnosticCaptureHandle;
  projectedSources.set(handle, { value, fields: fields.slice(0, 256) });
  return handle;
}

/** An already-serialized source frame; parsing waits for recorder content consent. */
export function diagnosticJsonContent(json: string): DiagnosticCaptureHandle {
  const handle = Object.freeze({}) as DiagnosticCaptureHandle;
  serializedSources.set(handle, json);
  return handle;
}

/** Bounded, detached JSON; does not invoke getters, toJSON or toString hooks. */
export function diagnosticValue(value: unknown, budget = 12_000): DiagnosticValue {
  return serializeDiagnosticValue(value, budget).value;
}

export function serializeDiagnosticValue(value: unknown, budget = 12_000): { value: DiagnosticValue; truncated: boolean; projected?: boolean } {
  let projection: readonly string[] | undefined;
  let index: ((value: object) => readonly PropertyKey[] | undefined) | undefined;
  if (value !== null && typeof value === "object") {
    const indexed = indexedSources.get(value);
    if (indexed !== undefined) { value = indexed.value; index = indexed.keys; }
  }
  if (value !== null && typeof value === "object") {
    const projected = projectedSources.get(value);
    if (projected !== undefined) { value = projected.value; projection = projected.fields; }
  }
  if (value !== null && typeof value === "object") {
    const serialized = serializedSources.get(value);
    if (serialized !== undefined) {
      // Never enumerate or parse an arbitrarily wide source object. Oversize
      // frames are explicitly omitted rather than exposing a partial secret.
      if (serialized.length > budget) return { value: "[serialized content omitted: capture budget]", truncated: true };
      try { value = JSON.parse(serialized) as unknown; }
      catch { return { value: "[invalid serialized content]", truncated: true }; }
    }
  }
  let remaining = budget;
  let truncated = false;
  const seen = new WeakSet<object>();
  function visit(input: unknown, depth: number, argumentFragments = false): DiagnosticValue {
    if (--remaining < 0 || depth > 10) { truncated = true; return OMITTED; }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "string") {
      // Bound regex work as well as the captured result.
      const size = Math.min(input.length, Math.max(0, remaining), 16_000);
      remaining -= size;
      // A bounded prefix may end inside a PEM block; the closing delimiter must
      // not be required for redaction, or truncation would expose key material.
      const prefix = input.slice(0, size).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "[REDACTED PRIVATE KEY]");
      const safe = redactSensitiveString(prefix).replace(/data:[^;,\s]+;base64,[a-z\d+/=]+/gi, "[media omitted]");
      if (size < input.length) truncated = true;
      return size < input.length ? `${safe}[truncated]` : safe;
    }
    if (typeof input === "bigint") {
      if (input > MAX_CAPTURE_BIGINT || input < -MAX_CAPTURE_BIGINT) { truncated = true; return "[bigint omitted: scalar budget]"; }
      return visit(String(input), depth + 1);
    }
    if (typeof input !== "object") { truncated = true; return OMITTED; }
    if (types.isProxy(input)) { truncated = true; return "[proxy omitted]"; }
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    if (types.isNativeError(input)) {
      const output: Record<string, DiagnosticValue> = {};
      // Native error details are usually non-enumerable. Read fixed descriptors
      // rather than invoking stack/name accessors or enumerating custom fields.
      for (const key of ["name", "message", "stack", "cause", "errors", "code", "domain", "kind", "retryable", "details"]) {
        let descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (key === "name" && descriptor === undefined) {
          let prototype: object | null = Object.getPrototypeOf(input) as object | null;
          for (let at = 0; at < 5 && prototype !== null && descriptor === undefined; at++) {
            if (types.isProxy(prototype)) { truncated = true; break; }
            descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            prototype = Object.getPrototypeOf(prototype) as object | null;
          }
        }
        if (descriptor === undefined) continue;
        remaining -= key.length;
        if ("value" in descriptor) output[key] = visit(descriptor.value, depth + 1, argumentFragments);
        else { output[key] = "[accessor omitted]"; truncated = true; }
      }
      return output;
    }
    if (Array.isArray(input)) {
      const output: DiagnosticValue[] = [];
      for (let at = 0; at < Math.min(input.length, 100) && remaining > 0; at++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(at));
        if (descriptor !== undefined && !("value" in descriptor)) truncated = true;
        output.push(descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1, argumentFragments) : OMITTED);
      }
      if (output.length < input.length) { truncated = true; output.push("[truncated]"); }
      return output;
    }
    const output: Record<string, DiagnosticValue> = Object.create(null) as Record<string, DiagnosticValue>;
    let count = 0;
    // Projection probes have an explicit work budget, including absent fields.
    // Generic enumeration is reserved for owned/serialized bounded input.
    const keys = projection ?? (index === undefined ? Object.keys(input) : index(input));
    if (keys === undefined) { truncated = true; return "[object omitted: source indexing budget]"; }
    for (const key of keys) {
      if (typeof key !== "string") { truncated = true; continue; }
      if (projection !== undefined && --remaining <= 0) { truncated = true; break; }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined) continue;
      if (++count > 100 || remaining <= 0) { truncated = true; output["[truncated]"] = true; break; }
      if (key.length > 160) { truncated = true; output["[oversize key omitted]"] = true; continue; }
      const safeKey = redactSensitiveString(key.slice(0, 160));
      remaining -= safeKey.length;
      const numericCount = TOKEN_COUNT.has(key) && descriptor && "value" in descriptor && typeof descriptor.value === "number";
      if (!("value" in descriptor)) truncated = true;
      const type = key === "delta" ? Object.getOwnPropertyDescriptor(input, "type") : undefined;
      const eventType: unknown = type !== undefined && "value" in type ? type.value : undefined;
      const argumentDelta = key === "delta" && typeof eventType === "string" &&
        ["response.function_call_arguments.delta", "response.custom_tool_call_input.delta", "toolcall_delta"].includes(eventType);
      const fragment = key === "partial_json" || key === "partialJson" || key === "partialArgs" ||
        key === "argumentTextDelta" || argumentDelta || (key === "arguments" && argumentFragments);
      if (fragment && "value" in descriptor && typeof descriptor.value === "string") {
        // A fragment can be valid JSON yet contain only an opaque secret value.
        // Never pretend it has the semantic field context needed for redaction.
        output[safeKey] = "[structured content omitted: argument fragment]";
        truncated = true;
        continue;
      }
      const structured = key === "arguments";
      if (structured && "value" in descriptor && typeof descriptor.value === "string") {
        // Tool arguments are JSON inside a string on some provider protocols.
        // Redact the semantic fields, and never store incomplete secret fragments.
        if (descriptor.value.length > remaining) {
          output[safeKey] = "[structured content omitted: capture budget]"; truncated = true;
        } else {
          const captured = serializeDiagnosticValue(diagnosticJsonContent(descriptor.value), remaining);
          const completeObject = captured.value !== null && typeof captured.value === "object" && !Array.isArray(captured.value);
          output[safeKey] = completeObject ? JSON.stringify(captured.value) : "[structured content omitted: incomplete or invalid JSON]";
          truncated ||= captured.truncated || !completeObject;
          remaining -= descriptor.value.length;
        }
        continue;
      }
      output[safeKey] = SECRET.test(key) && !numericCount ? "[REDACTED]" :
        descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1, argumentFragments || key === "delta") : OMITTED;
    }
    return output;
  }
  try { const captured = visit(value, 0); return { value: captured, truncated, ...(projection === undefined ? {} : { projected: true }) }; }
  catch { return { value: "[capture failed]", truncated: true }; }
}
