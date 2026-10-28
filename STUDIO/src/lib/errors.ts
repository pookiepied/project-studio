/** Client failures retain a category without importing the harness runtime. */
export class StudioError extends Error {
  readonly domain = 'client'
  readonly retryable = false
  readonly kind: string

  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
    this.name = 'StudioError'
  }
}
