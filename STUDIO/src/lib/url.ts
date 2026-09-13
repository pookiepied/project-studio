/** The hostname a link is to, without a leading `www.`; the href itself when it is not a URL. */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}
