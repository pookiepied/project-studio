import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { surfaceVariants, type SurfaceMove } from '@/design/tokens'
import { Button, Dialog, TextField } from '@/components/primitives'
import { Icons } from '@/components/icons'
import { Loading, StateNote } from '@/components/state'
import type { HarnessFailure } from '@/platform/harness'
import { findCatalogModel } from '@/domain/models/catalog'
import { familyCatalog, familyName } from '@/domain/models/families'
import { familyView, modelView, viewKey, viewMove, viewOf, FAMILIES_VIEW, type LibraryView } from './library/views'
import { LibraryIndex } from './library/LibraryIndex'
import { FamilyGrid } from './library/FamilyGrid'
import { FamilyModels } from './library/FamilyModels'
import { SearchResults } from './library/SearchResults'
import { ModelDetail } from './library/ModelDetail'
import type { CatalogState } from './CatalogStateNote'
import type { ReasoningChoice } from '@/domain/models/types'

/** The stage's page handover, re-read from the move at play time (`surfaceVariants` explains why). */
const STAGE_VARIANTS = surfaceVariants()

/**
 * The model library: the whole catalog, on a page that can hold it.
 *
 * ---- Why this is a dialog and not the picker -------------------------------
 *
 * The picker is a shortcut - three recents and a door. This is the room behind
 * the door: every model of every connection, with the facts a decision this
 * size deserves. An aggregator connection carries hundreds of models; squeezed
 * into a small popover they were an unscrollable wall, and the facts that
 * distinguish them - price, context, what the model can actually do - had
 * nowhere to appear at all.
 *
 * ---- The three levels ------------------------------------------------------
 *
 * The library reads like one: families first, then a family's models, then a
 * model's own page. The old layout put the list and the facts side by side in
 * two panes, and the panes fought - one scroll continued underneath the other,
 * and the details waited empty for a selection. Each level here owns the
 * stage outright and scrolls alone, and no level exists before its content
 * does, so there is no empty state to dress up. The index on the left keeps
 * the hierarchy one click wide: family to family without climbing back
 * through the landing.
 *
 * ---- Search -----------------------------------------------------------------
 *
 * The search field rides above every page, and a needle turns the stage into
 * results grouped by family - the one view that crosses families, which is
 * the point of it. Opening a model from results keeps the needle in the
 * field; the model page's back row is named for where it returns to, so
 * "Search results" and a family's name are honest labels rather than a
 * generic "Back".
 *
 * ---- Why the pages move like routes ----------------------------------------
 *
 * Push, pop and sibling - the vocabulary `RULES.md` gives the shell, applied
 * to the only handovers this dialog owns (see `library/views`). The dialog
 * frame is stable; the stage inside it is the surface that moves.
 */
export function ModelLibraryDialog({
  open,
  onClose,
  catalog,
  onUse,
  onOpenSettings,
  onEnsure,
}: {
  open: boolean
  onClose: () => void
  catalog: CatalogState
  onUse: (modelId: string, reasoningLevel: ReasoningChoice | null) => void
  onOpenSettings: () => void
  /** Re-reads the store the catalog rides on; the failure states' remedy. */
  onEnsure: () => Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const [familyAuthor, setFamilyAuthor] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningChoice | null>(null)
  const [move, setMove] = useState<SurfaceMove>('push')

  // Reopening starts over: a library that remembers a query from last time
  // answers a question nobody is asking yet.
  //
  // On the way out is safe, though it does not look it: the dialog's exit is
  // an AnimatePresence child, and the subtree it is holding is the one it
  // rendered last, so state changed after `open` went false never reaches the
  // screen. Measured before changing it - resetting on the way in instead
  // moved nothing at all.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setFamilyAuthor(null)
      setDetailId(null)
      setReasoningLevel(null)
      setMove('push')
    }
  }, [open])

  const ready = catalog.phase.status === 'ready'
  const families = useMemo(
    () => (ready ? familyCatalog(catalog.models) : []),
    [ready, catalog],
  )

  // Search groups what the needle matches, across every family at once - the
  // one view that is not one family deep.
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!ready || needle === '') return []
    const matching = catalog.models.filter((candidate) =>
      [candidate.name, candidate.modelId, candidate.author, candidate.connectionName]
        .join('\n')
        .toLowerCase()
        .includes(needle),
    )
    return familyCatalog(matching)
  }, [ready, catalog, query])

  const connections = useMemo(
    () => new Set(catalog.models.map((model) => model.connectionId)).size,
    [catalog],
  )

  const view = viewOf(query, detailId, familyAuthor)
  const detailModel = view.kind === 'model' ? findCatalogModel(catalog.models, view.id) : undefined
  // A detail page whose model the catalog no longer has falls back to the
  // page underneath rather than rendering a hole.
  const stage =
    view.kind === 'model' && detailModel === undefined ? viewOf('', null, familyAuthor) : view
  const searching = query.trim() !== ''

  // Every change of page names the move it is making; the stage animates by it.
  const go = (next: LibraryView) => setMove(viewMove(view, next))
  const openFamilies = () => {
    go(FAMILIES_VIEW)
    setFamilyAuthor(null)
    setDetailId(null)
  }
  const openFamily = (author: string) => {
    go(familyView(author))
    setFamilyAuthor(author)
    setDetailId(null)
  }
  const openModel = (id: string) => {
    go(modelView(id))
    setDetailId(id)
    setReasoningLevel(null)
  }
  const back = () => {
    go(viewOf('', null, familyAuthor))
    setDetailId(null)
  }
  const onQuery = (value: string) => {
    go(viewOf(value, null, familyAuthor))
    setQuery(value)
    setDetailId(null)
  }

  const use = () => {
    if (detailModel === undefined) return
    onUse(detailModel.id, reasoningLevel)
    onClose()
  }

  // The library is opened from the top strip, and the strip is itself a
  // positioned box - the Dialog's fixed overlay would measure fine here, but
  // the Popover, the Tooltip, and the lightbox all escape their ancestors for
  // the same reason this portalles: the overlay must cover the window, which
  // is what "a page over the app" means.
  return createPortal(
    <Dialog
      open={open}
      onClose={onClose}
      title="Model library"
      // Two thirds of the window, and a definite height: the three levels
      // scroll independently, which needs a box of known height to scroll in.
      // Wide enough that an aggregator's catalog reads as a page rather than a
      // scroll, capped so it never pretends to be the whole app.
      width="min(72rem, 74vw)"
      height="min(46rem, 100%)"
      footer={
        <>
          <Button variant="ghost" onClick={onOpenSettings}>
            <Icons.settings /> Add models in Settings...
          </Button>
          <Button variant="primary" disabled={detailModel === undefined} onClick={use}>
            Use this model
          </Button>
        </>
      }
    >
      {catalog.phase.status === 'loading' ? (
        <Loading label="Loading the model library" />
      ) : catalog.phase.status === 'ready' ? (
        <div className="flex h-full min-h-0">
          <LibraryIndex
            families={families}
            activeFamily={searching ? null : familyAuthor}
            familiesActive={!searching && familyAuthor === null}
            total={catalog.models.length}
            onSelectFamily={openFamily}
            onOpenFamilies={openFamilies}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-2 pl-4">
            <TextField
              value={query}
              onChange={onQuery}
              placeholder={`Search ${catalog.models.length} models`}
              ariaLabel="Search models"
              autoFocus
            />
            {/* The stage: exactly one page at a time, absolute while exiting so
                two pages crossfade in place instead of stacking. The move
                reaches the animation as `custom` because AnimatePresence
                freezes an exiting element's props -- the last-rendered exit is
                the PREVIOUS move's, so a back out of a drill-in would leave to
                the wrong side. Variants re-read the move as it plays. */}
            <div className="relative min-h-0 flex-1">
              <AnimatePresence initial={false} custom={move}>
                <motion.div
                  key={viewKey(stage)}
                  custom={move}
                  variants={STAGE_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="absolute inset-0"
                >
                  <div className="studio-scroll-bounded h-full overflow-y-auto pr-1">
                    {stage.kind === 'families' ? (
                      <FamilyGrid
                        families={families}
                        models={catalog.models}
                        connections={connections}
                        onSelect={openFamily}
                      />
                    ) : stage.kind === 'family' ? (
                      families
                        .filter((family) => family.author === stage.author)
                        .map((family) => (
                          <FamilyModels
                            key={family.author}
                            family={family}
                            onSelect={(model) => openModel(model.id)}
                          />
                        ))
                    ) : stage.kind === 'model' && detailModel !== undefined ? (
                      <ModelDetail
                        model={detailModel}
                        backLabel={searching ? 'Search results' : familyAuthor !== null ? familyName(familyAuthor) : 'All families'}
                        reasoningLevel={reasoningLevel}
                        onReasoning={setReasoningLevel}
                        onBack={back}
                      />
                    ) : (
                      <SearchResults
                        query={query.trim()}
                        families={results}
                        onSelect={(model) => openModel(model.id)}
                      />
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      ) : (
        <CatalogFailure
          status={catalog.phase.status}
          error={catalog.phase.error}
          onEnsure={onEnsure}
        />
      )}
    </Dialog>,
    document.body,
  )
}

/**
 * The catalog's two named failures, with the remedy as a control - the same
 * sentence-and-button shape every surface over this store uses.
 */
function CatalogFailure({
  status,
  error,
  onEnsure,
}: {
  status: 'no-harness' | 'failed'
  error: HarnessFailure | null
  onEnsure: () => Promise<boolean>
}) {
  const [asking, setAsking] = useState(false)

  return (
    <div className="flex h-full flex-col justify-center">
      {status === 'no-harness' ? (
        <StateNote
          title="The harness is not running."
          detail="The model catalog is read from the harness, so there is nothing to browse until it starts."
          action={
            <Button
              variant="secondary"
              size="sm"
              busy={asking}
              onClick={() => {
                setAsking(true)
                void onEnsure().finally(() => setAsking(false))
              }}
            >
              Start the harness
            </Button>
          }
        />
      ) : (
        <StateNote
          title="Could not read the model catalog."
          detail={error?.message ?? 'The harness stopped answering.'}
          action={
            <Button
              variant="secondary"
              size="sm"
              busy={asking}
              onClick={() => {
                setAsking(true)
                void onEnsure().finally(() => setAsking(false))
              }}
            >
              Try again
            </Button>
          }
        />
      )}
    </div>
  )
}

