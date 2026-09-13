import type { ReactNode } from 'react'
import { Deferred, lazyNamed } from '@/components/state'
import { AppearancePane } from '@/features/settings/panes/AppearancePane'
import { ArchivePane } from '@/features/settings/panes/ArchivePane'
import { GeneralPane } from '@/features/settings/panes/GeneralPane'
import { PaneSkeleton, PlaceholderPane } from '@/features/settings/panes/Pane'
import { PLACEHOLDERS } from '@/features/settings/panes/placeholders'

// The four heavy panes arrive when first opened. General, appearance and
// the archive are small and stay eager, so the landing pane is never a
// skeleton. Each of these carries a dialog or two, a table, and its own
// harness calls - the providers pane alone was a fifth of the bundle.
const ProvidersPane = lazyNamed(
  () => import('@/features/settings/providers/ProvidersPane'),
  'ProvidersPane',
)
const McpPane = lazyNamed(() => import('@/features/settings/mcp/McpPane'), 'McpPane')
const EnvironmentsPane = lazyNamed(
  () => import('@/features/settings/environments/EnvironmentsPane'),
  'EnvironmentsPane',
)
const DevicesPane = lazyNamed(() => import('@/features/settings/devices/DevicesPane'), 'DevicesPane')

function deferred(label: string, pane: ReactNode): () => ReactNode {
  return () => (
    <Deferred label={label} fallback={<PaneSkeleton />}>
      {pane}
    </Deferred>
  )
}

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
  models: deferred('Models', <ProvidersPane kind="language" />),
  media: deferred('Media', <ProvidersPane kind="media" />),
  tools: deferred('Tools', <ProvidersPane kind="retrieval" />),
  mcp: deferred('MCP servers', <McpPane />),
  environments: deferred('Environments', <EnvironmentsPane />),
  devices: deferred('Other devices', <DevicesPane />),
}

export function paneFor(sectionId: string): ReactNode {
  const Built = BUILT[sectionId]
  if (Built) return <Built />

  const placeholder = PLACEHOLDERS[sectionId]
  if (placeholder) return <PlaceholderPane {...placeholder} />

  // An unknown id is a stale link, not a crash. General is the honest landing.
  return <GeneralPane />
}
