export class InspectorError extends Error {
  constructor(code, message) { super(message); this.name = 'InspectorError'; this.code = code }
}

export function fail(code, message) { throw new InspectorError(code, message) }
export function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function text(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null }
export function integer(value, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_argument', 'A numeric argument is outside its supported range.')
  return value
}
