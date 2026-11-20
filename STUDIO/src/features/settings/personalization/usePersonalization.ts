import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useHarnessClient,
  type HarnessFailure,
  type MemoryDraft,
  type MemoryEdit,
  type MemoryEntryResult,
  type MemoryListing,
  type MemoryProfile,
  type MemoryScope,
  type MemorySettings,
} from '@/platform/harness'
import { NO_HARNESS } from '@/features/library/client'

/**
 * The Personalization pane's data: the profile, the memory switch, and the
 * saved memories under the current search. Every write re-reads the list,
 * because a batch can partly apply and the list is the truth either way.
 */

export interface MemoryFilter {
  readonly query: string
  readonly scope: MemoryScope | null
}

export type PersonalizationView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly profile: MemoryProfile
      readonly settings: MemorySettings
      readonly listing: MemoryListing
    }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

/** What a write came back with: a request that failed, or the refused entries. */
export type WriteOutcome =
  | { readonly ok: true; readonly refused: readonly string[] }
  | { readonly ok: false; readonly error: HarnessFailure }

export interface Personalization {
  readonly view: PersonalizationView
  readonly filter: MemoryFilter
  setFilter: (filter: MemoryFilter) => void
  saveProfile: (profile: MemoryProfile) => Promise<HarnessFailure | null>
  setEnabled: (enabled: boolean) => Promise<HarnessFailure | null>
  save: (drafts: readonly MemoryDraft[]) => Promise<WriteOutcome>
  edit: (edits: readonly MemoryEdit[]) => Promise<WriteOutcome>
  forget: (ids: readonly string[]) => Promise<WriteOutcome>
}

function refusals(results: readonly MemoryEntryResult[]): readonly string[] {
  return results.flatMap((result) => (result.ok ? [] : [result.error]))
}

export function usePersonalization(): Personalization {
  const connect = useHarnessClient()
  const [view, setView] = useState<PersonalizationView>({ status: 'loading' })
  const [filter, setFilter] = useState<MemoryFilter>({ query: '', scope: null })
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const read = useCallback(async () => {
    const harness = await connect()
    if (!live.current) return
    if (harness === null) {
      setView({ status: 'no-harness' })
      return
    }
    const [profile, settings, listing] = await Promise.all([
      harness.readMemoryProfile(),
      harness.readMemorySettings(),
      harness.listMemories({
        ...(filter.query.trim() === '' ? {} : { query: filter.query.trim() }),
        ...(filter.scope === null ? {} : { scope: filter.scope }),
        limit: 100,
      }),
    ])
    if (!live.current) return
    if (!profile.ok) return setView({ status: 'failed', error: profile.error })
    if (!settings.ok) return setView({ status: 'failed', error: settings.error })
    if (!listing.ok) return setView({ status: 'failed', error: listing.error })
    setView({ status: 'ready', profile: profile.value, settings: settings.value, listing: listing.value })
  }, [connect, filter])

  useEffect(() => {
    const timer = setTimeout(() => void read(), filter.query === '' ? 0 : 200)
    return () => clearTimeout(timer)
  }, [read, filter.query])

  const write = useCallback(
    async (
      run: (harness: NonNullable<Awaited<ReturnType<typeof connect>>>) => Promise<
        { ok: true; value: readonly MemoryEntryResult[] } | { ok: false; error: HarnessFailure }
      >,
    ): Promise<WriteOutcome> => {
      const harness = await connect()
      if (harness === null) return { ok: false, error: NO_HARNESS }
      const result = await run(harness)
      await read()
      return result.ok ? { ok: true, refused: refusals(result.value) } : { ok: false, error: result.error }
    },
    [connect, read],
  )

  return {
    view,
    filter,
    setFilter,
    saveProfile: useCallback(
      async (profile: MemoryProfile) => {
        const harness = await connect()
        if (harness === null) return NO_HARNESS
        const result = await harness.saveMemoryProfile(profile)
        if (!result.ok) return result.error
        await read()
        return null
      },
      [connect, read],
    ),
    setEnabled: useCallback(
      async (enabled: boolean) => {
        const harness = await connect()
        if (harness === null) return NO_HARNESS
        const result = await harness.saveMemorySettings({ enabled })
        if (!result.ok) return result.error
        await read()
        return null
      },
      [connect, read],
    ),
    save: useCallback((drafts: readonly MemoryDraft[]) => write((harness) => harness.saveMemories(drafts)), [write]),
    edit: useCallback((edits: readonly MemoryEdit[]) => write((harness) => harness.editMemories(edits)), [write]),
    forget: useCallback((ids: readonly string[]) => write((harness) => harness.forgetMemories(ids)), [write]),
  }
}
