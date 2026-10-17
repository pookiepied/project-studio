import { createHash } from 'node:crypto'

const SECRET = /(?:password|passwd|passphrase|secret|credential|authorization|cookie|api.?key|token|private.?key)|^(?:env|environment|processEnv)$/i
const TOKEN_COUNTS = /^(?:input|output|total|cached|cacheRead|cacheWrite|reasoning|prompt|completion)Tokens$/i

export function redactString(value) {
  return value
    .replace(/-----BEGIN [^-\r\n]{0,80}PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]{0,80}PRIVATE KEY-----|$)/g, '[redacted private key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})/g, '[redacted]')
    .replace(/((?:[\w.-]{0,100}(?:password|passwd|passphrase|secret|credential|authorization|cookie|api.?key|access.?token|refresh.?token)[\w.-]{0,100})["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, '$1[redacted]')
}

/** Only bounded, parsed JSON enters this function, never foreign runtime objects. */
export function redact(value, includeContent = true) {
  let remaining = 16_000
  function visit(input, depth) {
    if (--remaining < 0 || depth > 32) return '[omitted: inspection budget]'
    if (typeof input === 'string') {
      const safe = redactString(input)
      return safe.length > 131_072 ? `${safe.slice(0, 131_072)}[truncated]` : safe
    }
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input
    if (Array.isArray(input)) {
      const result = []
      for (const item of input.slice(0, 2000)) {
        if (remaining <= 0) { result.push('[omitted: inspection budget]'); break }
        result.push(visit(item, depth + 1))
      }
      if (input.length > 2000) result.push('[omitted: array limit]')
      return result
    }
    if (input && typeof input === 'object') {
      const result = Object.create(null)
      const entries = Object.entries(input)
      for (const [key, item] of entries.slice(0, 256)) {
        if (remaining <= 0) { result.__inspectorOmission = 'inspection_budget'; break }
        if (!includeContent && key === 'content') continue
        result[key] = SECRET.test(key) && !(TOKEN_COUNTS.test(key) && typeof item === 'number') ? '[redacted]' : visit(item, depth + 1)
      }
      if (entries.length > 256) result.__inspectorOmission = 'object_field_limit'
      return result
    }
    return '[unavailable]'
  }
  return visit(value, 0)
}

export function hash(value) { return createHash('sha256').update(value).digest('hex') }
