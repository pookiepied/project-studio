import type { HarnessFailure } from '@/platform/harness'

export interface CatalogState {
  readonly phase: {
    readonly status: 'loading' | 'ready' | 'no-harness' | 'failed'
    readonly error: HarnessFailure | null
  }
}

export function CatalogStateNote({ catalog }: { catalog: CatalogState }) {
  if (catalog.phase.status === 'loading') {
    return <Note>Reading models...</Note>
  }
  if (catalog.phase.status === 'no-harness') {
    return <Note>No harness is running, so there are no models to choose yet.</Note>
  }
  if (catalog.phase.status === 'failed') {
    return <Note>Could not read the model catalog. {catalog.phase.error?.message ?? ''}</Note>
  }
  return null
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-ui text-muted-foreground">{children}</p>
}
