/** The first letter upper-cased, the rest untouched: a level id shown as a label. */
export function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}
