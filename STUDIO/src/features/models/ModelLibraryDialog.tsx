import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { surfaceVariants, type SurfaceMove } from '@/design/tokens'
import { Button, Dialog, TextField } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import type { HarnessFailure } from '@/platform/harness'
import { findCatalogModel } from '@/domain/models/catalog'
import { connectionCatalog } from '@/domain/models/connections'
import { familyName } from '@/domain/models/families'
import {
  CONNECTIONS_VIEW,
  connectionView,
  modelView,
  viewKey,
  viewMove,
  viewOf,
  type LibraryView,
} from './library/views'
import { ConnectionList } from './library/ConnectionList'
import { ConnectionModels } from './library/ConnectionModels'
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
 * The library reads like one: connections first, then a connection's models,
 * then a model's own page. Each level owns the stage outright and scrolls
 * alone, and no level exists before its content does, so there is no empty
 * state to dress up. The first axis was the model family for a while - the
 * vendor whose mark a model wears - and it was the wrong one: the author is
 * a guess wherever a host names its models bare, so the same model showed up
 * under two families and a custom endpoint became one. The connection is the
 * fact every row carries for certain (`domain/models/connections`).
 *
 * There used to be an index column beside the stage as well, naming the
 * same things the landing named. The window this app lives in is small; one
 * list is the whole page, and the back row is the way up.
 *
 * ---- Search -----------------------------------------------------------------
 *
 * The search field rides above every page, and a needle turns the stage into
 * results grouped by connection - the one view that crosses connections,
 * which is the point of it. Opening a model from results keeps the needle in
 * the field; the model page's back row is named for where it returns to, so
 * "Search results" and a connection's name are honest labels rather than a
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
  const [connectionId, setConnectionId] = useState<string | null>(null)
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
      setConnectionId(null)
      setDetailId(null)
      setReasoningLevel(null)
      setMove('push')
    }
  }, [open])

  const ready = catalog.phase.status === 'ready'
  const connections = useMemo(
    () => (ready ? connectionCatalog(catalog.models) : []),
    [ready, catalog],
  )

  // Search groups what the needle matches, across every connection at once -
  // the one view that is not one connection deep.
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!ready || needle === '') return []
    const matching = catalog.models.filter((candidate) =>
      [candidate.name, candidate.modelId, familyName(candidate.author), candidate.connectionName]
        .join('\n')
        .toLowerCase()
        .includes(needle),
    )
    return connectionCatalog(matching)
  }, [ready, catalog, query])

  const view = viewOf(query, detailId, connectionId)
  const detailModel = view.kind === 'model' ? findCatalogModel(catalog.models, view.id) : undefined
  const openConnection = connections.find((connection) => connection.id === connectionId)
  // A page whose content the catalog no longer has falls back to the page
  // underneath rather than rendering a hole.
  const stage =
    (view.kind === 'model' && detailModel === undefined) ||
    (view.kind === 'connection' && openConnection === undefined)
      ? CONNECTIONS_VIEW
      : view
  const searching = query.trim() !== ''

  // Every change of page names the move it is making; the stage animates by it.
  const go = (next: LibraryView) => setMove(viewMove(view, next))
  const openConnections = () => {
    go(CONNECTIONS_VIEW)
    setConnectionId(null)
    setDetailId(null)
  }
  const selectConnection = (id: string) => {
    go(connectionView(id))
    setConnectionId(id)
    setDetailId(null)
  }
  const openModel = (id: string) => {
    go(modelView(id))
    setDetailId(id)
    setReasoningLevel(null)
  }
  const back = () => {
    go(viewOf('', null, connectionId))
    setDetailId(null)
  }
  const onQuery = (value: string) => {
    go(viewOf(value, null, connectionId))
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
      // A reading column, not a second window: wide enough for a name, three
      // marks, a context and a price on one line, and no wider. A definite
      // height, because the stage scrolls inside it.
      width="min(36rem, 92vw)"
      height="min(34rem, 100%)"
      layout="fill"
      // The one action the library has, shown on the one page it applies to.
      footer={
        stage.kind === 'model' ? (
          <Button variant="primary" disabled={detailModel === undefined} onClick={use}>
            Use this model
          </Button>
        ) : undefined
      }
    >
      {catalog.phase.status === 'loading' ? (
        <Loading label="Loading the model library" />
      ) : catalog.phase.status === 'ready' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
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
                  {stage.kind === 'connections' ? (
                    <ConnectionList
                      connections={connections}
                      onSelect={selectConnection}
                      onOpenSettings={onOpenSettings}
                    />
                  ) : stage.kind === 'connection' && openConnection !== undefined ? (
                    <ConnectionModels
                      connection={openConnection}
                      onSelect={(model) => openModel(model.id)}
                      onBack={openConnections}
                    />
                  ) : stage.kind === 'model' && detailModel !== undefined ? (
                    <ModelDetail
                      model={detailModel}
                      backLabel={
                        searching
                          ? 'Search results'
                          : openConnection !== undefined
                            ? openConnection.name
                            : 'All connections'
                      }
                      reasoningLevel={reasoningLevel}
                      onReasoning={setReasoningLevel}
                      onBack={back}
                    />
                  ) : (
                    <SearchResults
                      query={query.trim()}
                      connections={results}
                      onSelect={(model) => openModel(model.id)}
                    />
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
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
