import type { ReactNode } from 'react'
import { AppearancePane } from '@/features/settings/panes/AppearancePane'
import { ArchivePane } from '@/features/settings/panes/ArchivePane'
import { GeneralPane } from '@/features/settings/panes/GeneralPane'
import { PlaceholderPane } from '@/features/settings/panes/Pane'
import { ProvidersPane } from '@/features/settings/providers/ProvidersPane'
import { PLACEHOLDERS } from '@/features/settings/panes/placeholders'

/**
 * Section id to the thing that renders it.
 *
 * A lookup, not a `switch` in the page, so adding a section is one line here
 * and one line in `sections.ts` and touches nothing else. The page never learns
 * the name of a single pane.
 */
const BUILT: Readonly<Record<string, () => ReactNode>> = {
  general: GeneralPane,
  appearance: AppearancePane,
  archive: ArchivePane,
  providers: ProvidersPane,
}

export function paneFor(sectionId: string): ReactNode {
  const Built = BUILT[sectionId]
  if (Built) return <Built />

  const placeholder = PLACEHOLDERS[sectionId]
  if (placeholder) return <PlaceholderPane {...placeholder} />

  // An unknown id is a stale link, not a crash. General is the honest landing.
  return <GeneralPane />
}
