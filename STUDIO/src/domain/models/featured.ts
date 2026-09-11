import type { ProviderModel } from '@/platform/harness'

/**
 * The featured shelf.
 *
 * `featured` is the declared catalog's word for the few models Studio
 * recommends for what they do, carried beside whatever else the connection
 * offers. Two surfaces read it, and they read it the same way: featured
 * first, everything else beneath in the order it arrived - the shelf, and
 * the recommendation at the top of the picker. The MARK is text, not a
 * glyph: the word says what the order already shows.
 */

export const FEATURED_LABEL = 'Featured'

/** Featured first, then the rest, arriving order preserved inside each half. */
export function featuredFirst(models: readonly ProviderModel[]): readonly ProviderModel[] {
  const featured = models.filter((model) => model.featured)
  if (featured.length === 0) return models
  return [...featured, ...models.filter((model) => !model.featured)]
}
