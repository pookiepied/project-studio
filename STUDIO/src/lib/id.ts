/** Short opaque identifiers for locally created records. */
export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}
