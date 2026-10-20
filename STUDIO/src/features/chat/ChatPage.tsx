import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { visionRefusal } from '@/domain/attachments/images'
import { uploadDocuments } from '@/features/chat/connection/documents'
import { Composer } from '@/features/chat/composer'
import { QueuedMessages } from '@/features/chat/composer/QueuedMessages'
import { useQueuedMessages } from '@/features/chat/connection/useQueuedMessages'
import { AnsweredElsewhere } from '@/features/chat/AnsweredElsewhere'
import { useForkConversation } from '@/features/chat/connection/fork'
import { useAutoScroll } from '@/features/chat/transcript'
import { galleryItems } from '@/features/chat/gallery/items'
import { ConnectionNotice, SendRefusal } from '@/features/chat/transcript/live/ConnectionNotice'
import { LiveTranscript } from '@/features/chat/transcript/live/LiveTranscript'
import { TranscriptWait } from '@/features/chat/transcript/live/TranscriptWait'
import { useConversationTranscript } from '@/features/chat/connection/useConversationTranscript'
import { isTurnRunning } from '@/features/chat/connection/useConversation'
import { ApprovalPrompt } from '@/features/chat/permissions/ApprovalPrompt'
import { usePendingApprovals } from '@/features/chat/permissions/usePendingApprovals'
import { QuestionPrompt } from '@/features/chat/questions/QuestionPrompt'
import { usePendingQuestions } from '@/features/chat/questions/usePendingQuestions'
import { JobsPill, useBackgroundJobs } from '@/features/jobs'
import { PlanPill, usePlan } from '@/features/plans'
import { jobsEntryId, planEntryId, useRail } from '@/stores/rail'
import { useBrowserPreview } from '@/features/chat/useBrowserPreview'
import { useComputerIndicator } from '@/features/chat/useComputerIndicator'
import { GALLERY_CONVERSATION_ID } from '@/domain/conversation/gallery'
import { contextReport } from '@/domain/turn/context'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type MeasuredContextUsage,
} from '@/platform/harness'
import { effectiveTurnSettings } from '@/domain/turn/settings'
import { turnSettingsToWire } from '@/platform/harness'
import { useLiveWork, useWorkspace } from '@/stores/workspace'
import type { SeamFailure, TurnImageWire } from '@/platform/harness'
import type { Conversation } from '@/domain/conversation/types'

/**
 * A conversation: a scrolling transcript with the composer beneath it.
 *
 * The composer is the same component and the same measure as on home, so
 * sending the first message moves the field up the screen rather than replacing
 * it with a different one. Nothing about the control changes — only its
 * position — which makes the transition read as the room rearranging rather
 * than as a new page.
 *
 * Both ends fade into the surface instead of meeting a bar. The strip above and
 * the composer below paint no fill, so a gradient is what separates them from
 * the text scrolling past, and `studio-scroll-inset` keeps the scroll thumb out
 * from under those gradients.
 *
 * ---- Where the words come from --------------------------------------------
 *
 * Every ordinary conversation renders LIVE: the transcript is a projection of
 * the harness's event stream (`useConversationTranscript`), and the composer
 * submits to the harness. What the UI shows and what the model receives are
 * two projections of one log here, never derived from each other — nothing
 * in the live path reads rendered state to build a request.
 *
 * The artifact gallery is the one exception: it is a display of artifacts,
 * not a conversation with an agent. It draws through the same live
 * components from a fixed list of items (`galleryItems`), with no harness
 * behind it and no composer under it — nothing sent there could be answered.
 */
/**
 * The least an open with a history behind it may take, from arriving on
 * the page to the words being shown.
 *
 * A conversation that fits the viewport appears the moment it is complete.
 * A longer one is landed on at its bottom behind the wait (see "The open"
 * in `useAutoScroll`), and the wait is kept for at least this long before
 * the words rise into place there, so an open that would otherwise be a
 * flash - the wait for a frame, then everything - is a wait, then the words.
 * Nothing is delayed that has no history to arrive.
 */
const OPEN_MIN_WAIT_MS = 700

export function ChatPage({ conversation }: { conversation: Conversation }) {
  const { touch, settings, catalog } = useWorkspace()
  const { markRunning, markContextReport, contextRevisions, compacting } = useLiveWork()
  const gallery = conversation.id === GALLERY_CONVERSATION_ID

  const live = useConversationTranscript(conversation.id)
  const queue = useQueuedMessages(conversation.id, isTurnRunning(live.phase), live.followQueued)
  // Built once per gallery visit: the list is fixed, and a fresh array each
  // render would re-key the memoized rows for nothing.
  const [shown] = useState(() => (gallery ? galleryItems() : null))
  const items = shown ?? live.items

  // The permission questions this conversation's runs raise, and the answers
  // a person gives here. Inactive on the gallery: nothing there is real
  // enough to need consent.
  const approvals = usePendingApprovals(conversation.id, {
    enabled: !gallery,
    active: isTurnRunning(live.phase),
    hasProject: conversation.projectId !== null,
  })

  // The questions a run raises to get a decision - the other kind of stop,
  // and the other channel. Inactive on the gallery for the same reason.
  const questions = usePendingQuestions(conversation.id, {
    enabled: !gallery,
    active: isTurnRunning(live.phase),
  })

  // The conversation's plan: what the run says it is doing, which the person
  // can read and tick. It blocks nothing, so it mounts beside the blocking
  // cards rather than over them, and survives the turn that wrote it.
  const plan = usePlan(conversation.id, {
    enabled: !gallery,
    active: isTurnRunning(live.phase),
  })

  // The commands the model left running. Read on its own cadence rather than
  // the run's: a download started three turns ago is still writing output long
  // after the turn that began it ended.
  const jobs = useBackgroundJobs(conversation.id, { enabled: !gallery })

  /**
   * True from the moment the words leave the composer until the harness
   * answers with a receipt.
   *
   * The phase machine cannot cover this window: it only turns `submitted`
   * once the POST has come back, and until then it still says `live`. So
   * everything watching the phase - the sidebar's working mark, the title's
   * shimmer - stayed still through a gap that on a real send is long enough
   * to read as nothing having happened. The composer already held this fact
   * privately, for its own stop control; the page holds it too, because the
   * question "is this conversation working" is asked from outside the
   * composer and has to be true from the click.
   */
  const [sending, setSending] = useState(false)

  // The sidebar's working mark is only as honest as its witness, and for a
  // real turn this page is the only one there is: the send above, which is
  // what makes the mark true from the click rather than from the receipt, and
  // the phase machine below, which is
  // what saw the admission (the receipt) and what sees the settlement (the
  // wire). While it reports submitted or streaming, the conversation is
  // working -- including when this page is not the one on screen, which is
  // the only question the sidebar asks. Unmount clears nothing: a turn
  // outlives the view that watches it (ADR 0045), so the mark persists until
  // a witness -- this one on return, another window's -- sees it settle.
  // `interrupted` clears it, though the run may technically live on: a mark
  // with no witness behind it is the invented progress the mark exists to
  // refuse, and resuming re-marks it within one replay.
  useEffect(() => {
    if (gallery) return
    markRunning(conversation.id, sending || isTurnRunning(live.phase))
    // The status is the whole question here, and `live.phase` is a fresh
    // object on every update: depending on it would re-mark the sidebar on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery, conversation.id, sending, live.phase.status, markRunning])
  // The provider's own figure for the last request, which is the only honest
  // answer to "how full is the window". Fetched rather than derived: it is
  // measured where the request is made and reaches the webview by no other
  // route - the transcript's own `usage` field is never populated under Flue
  // 2.0, which is what left this page estimating from rendered characters and
  // reporting about half the real number.
  //
  // Re-fetched when a turn stops running, because that is when a new figure
  // exists. Not polled while one runs: the number cannot change until a model
  // request completes, and the estimate below covers the gap in the meantime.
  //
  // Also re-fetched when the strip's "Compact now" has finished, which the
  // store announces by bumping the conversation's revision: a compaction
  // changes the figure without a turn ending.
  const [measuredContext, setMeasuredContext] = useState<MeasuredContextUsage | null>(null)
  const running = isTurnRunning(live.phase)
  const contextRevision = contextRevisions.get(conversation.id) ?? 0
  useEffect(() => {
    if (gallery) return
    let watching = true
    void (async () => {
      const address = await resolveHarnessAddress()
      if (address === null || !watching) return
      const result = await createHarnessClient(address).conversationContext(conversation.id)
      // The conversation may have changed under us while the request was in
      // flight; a figure from the previous one is worse than none.
      if (!watching || !result.ok) return
      setMeasuredContext(result.value)
    })()
    return () => {
      watching = false
    }
  }, [gallery, conversation.id, running, contextRevision])

  /**
   * A compaction of this conversation, and the re-read one leaves behind.
   *
   * The harness writes the compaction into the conversation's record, and an
   * attached stream delivers a snapshot only when a read begins — so the page
   * that asked for the compaction would otherwise show the wait row collapse
   * and then nothing, the record waiting for the conversation to be reopened.
   * A reattach is the re-read: quiet in both directions (an `attaching` phase
   * renders no notice, and compaction cannot run while a turn holds the
   * session), and the reseeded projection brings the marker in at the tail,
   * exactly where the wait row stood. Witnessed per conversation, so a flag
   * still set for another conversation cannot re-read this one.
   */
  const compactingHere = !gallery && compacting.has(conversation.id)
  const compactingWitnessed = useRef<string | null>(null)
  useEffect(() => {
    if (compactingHere) {
      compactingWitnessed.current = conversation.id
      return
    }
    if (compactingWitnessed.current !== conversation.id) return
    compactingWitnessed.current = null
    live.resume()
    // `live.resume` is identity-stable — a useCallback over the attach, whose
    // own inputs outlive a conversation — while `live` is a fresh object every
    // render; depending on it would re-run this on every streamed delta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactingHere, conversation.id, live.resume])

  // What the history costs, reported to the store so the top strip can show
  // it. This page is the only witness: the strip has no transcript of its
  // own, exactly as with the working mark. Recomputed on every delivery, so
  // the ring moves while a turn runs rather than jumping when it ends - the
  // store drops a report that says the same thing as the one it holds, which
  // is what keeps a streamed delta from re-rendering the strip.
  useEffect(() => {
    if (gallery) return
    markContextReport(conversation.id, contextReport(live.items, measuredContext, running))
  }, [gallery, conversation.id, live.items, measuredContext, running, markContextReport])

  // When the open began, per conversation, for the minimum wait below.
  const openedFor = useRef<string | null>(null)
  const openedAt = useRef(0)
  if (openedFor.current !== conversation.id) {
    openedFor.current = conversation.id
    openedAt.current = performance.now()
  }
  /** The conversation whose words have been revealed; the gallery's always are. */
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  const revealed = gallery || revealedFor === conversation.id
  // Something to show: an item from the log, or the message this window
  // just sent and is waiting to see echoed. A first send in a new
  // conversation is words too, and must not wait on a replay that has
  // nothing in it.
  const hasWords = items.length > 0 || (!gallery && live.pending !== null)

  const { viewport, pinned, landed, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom } =
    useAutoScroll(items, conversation.id, revealed)

  // Nothing is shown while the replay is still coming. It arrives a
  // delivery at a time, and the first delivery is usually one message that
  // fits the viewport: judged on its own it would be revealed at once, and
  // the rest of the history would then pour in under a page that had
  // already said it was ready. The whole history is held until the harness
  // says it is up to date; a message this window is sending is its own
  // words and does not wait on anything.
  const replaying = !gallery && live.phase.status === 'attaching' && live.pending === null

  // The words are laid out before they are shown (opacity, not absence),
  // and the scroll hook lands the viewport at their bottom while they are
  // unseen. Once it has landed and the history is complete, the page asks
  // whether there was anywhere to land: a transcript that fits the viewport
  // is revealed at once; one that scrolled waits out `OPEN_MIN_WAIT_MS`
  // from the open, then is revealed where it stands, at the bottom. Layout
  // effect, so the answer is read before the frame paints.
  useLayoutEffect(() => {
    if (revealed || !hasWords || replaying || !landed) return
    const element = viewport.current
    const scrolled = element !== null && element.scrollTop > 0
    const remaining = scrolled ? OPEN_MIN_WAIT_MS - (performance.now() - openedAt.current) : 0
    if (remaining <= 0) {
      setRevealedFor(conversation.id)
      return
    }
    const timer = setTimeout(() => setRevealedFor(conversation.id), remaining)
    return () => clearTimeout(timer)
  }, [revealed, hasWords, replaying, landed, conversation.id, viewport])

  // Branch from one answer: everything up to and including it becomes the
  // first message of a new conversation, named for its source.
  const { branchFrom } = useForkConversation()

  // Both row callbacks are held identity-stable on purpose: the transcript
  // rows are memoized, and a fresh closure per render would un-memoize the
  // whole window on every streamed delta. The branch needs the current
  // items, so it reads them through a ref that always holds the latest.
  const branchRef = useRef<(messageId: string) => void>(() => {})
  branchRef.current = (messageId: string) => {
    void branchFrom(conversation, live.items, messageId)
  }
  const onBranch = useCallback((messageId: string) => branchRef.current(messageId), [])

  /**
   * A refusal the send path raises before the POST: the turn is addressed to
   * a model that cannot see, and it is carrying images. Held here, beside the
   * connection notices, because it is a send the composer kept — the words
   * and the strip stay, and the sentence explains why nothing left.
   */
  const [attachRefusal, setAttachRefusal] = useState<SeamFailure | null>(null)

  /**
   * A receipt is also a recency fact: the index stamps the conversation the
   * moment the harness admits a later turn, so sorting survives a reload.
   * The turn goes out with this conversation's settled settings - the row's
   * choice when it has one, the window's otherwise - the same derivation the
   * picker displays, so what is on screen is what is sent.
   */
  const sendTurn = useCallback(
    async (text: string, images: readonly TurnImageWire[], documents: readonly File[], deliveryMode?: 'queue' | 'steer') => {
      const effective = effectiveTurnSettings(conversation, settings)
      const refused = visionRefusal(effective.modelId, images.length, catalog.models)
      if (refused !== null) {
        setAttachRefusal(refused)
        return { ok: false }
      }
      setAttachRefusal(null)
      // The mode travels in the submission body like the model and reasoning
      // do, translated into the harness's vocabulary at the wire boundary:
      // what the picker shows is what the turn is admitted under.
      setSending(true)
      try {
        // Documents go up ahead of the words, and come back down if the
        // words do not go: `connection/documents.ts` says why.
        const uploaded = await uploadDocuments(conversation.id, documents)
        if (!uploaded.ok) {
          setAttachRefusal(uploaded.error)
          return { ok: false }
        }
        const sent = await live.submit(text, {
          ...turnSettingsToWire(effective),
          ...(deliveryMode === undefined ? {} : { deliveryMode }),
        }, images)
        if (!sent.ok) await uploaded.takeBack()
        if (sent.ok) {
          void queue.refresh()
          touch(conversation.id)
          // Sending is a return to the end. A message written from halfway
          // up the history belongs at the bottom, and the reply it earns
          // lands there too; leaving the reader where they were made both
          // arrive out of sight, which is the one place a sent message
          // should never be.
          scrollToBottom()
        }
        return sent
      } finally {
        // Released whatever the answer was. A receipt hands the fact to the
        // phase, which is already `submitted` in the render this release
        // lands in; a refusal has nothing to hand it to, and holding this
        // would leave the conversation marked as working forever.
        setSending(false)
      }
    },
    // The method, not the object it hangs off: `live` is rebuilt every
    // render and only `submit` is called here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation, catalog.models, live.submit, settings, touch, scrollToBottom],
  )

  /**
   * Stopping the run withdraws its questions. The abort itself usually
   * cancels the pending approvals on the harness side - the kernel hands the
   * run's abort signal to the approver - but the withdrawal here is what
   * guarantees nothing is left waiting when the signal is not heard, and a
   * cancel on an already-cleared row is an honest 404. The ask channel has
   * no signal held by the kernel, so this withdrawal is its cleanup too.
   */
  const stopTurn = useCallback(() => {
    approvals.cancelAll()
    questions.cancelAll()
    void live.abort()
  }, [approvals, questions, live])

  // The pill is a disclosure control and nothing else: open when the rail is
  // showing this conversation's plan, and a second click takes it back down.
  // A plan entry that exists but is not on screen comes forward rather than
  // being opened twice - the rail keys it to the conversation either way.
  const {
    open: railOpen,
    activeId: railActiveId,
    openPlan,
    openJobs,
    close: closeRailEntry,
  } = useRail()
  const planEntryVisible = railOpen && railActiveId === planEntryId(conversation.id)
  const jobsEntryVisible = railOpen && railActiveId === jobsEntryId(conversation.id)
  const togglePlanPanel = useCallback(() => {
    if (planEntryVisible) {
      closeRailEntry(planEntryId(conversation.id))
      return
    }
    openPlan(conversation.id, conversation.title ?? 'Conversation')
  }, [planEntryVisible, closeRailEntry, openPlan, conversation.id, conversation.title])

  const toggleJobsPanel = useCallback(() => {
    if (jobsEntryVisible) {
      closeRailEntry(jobsEntryId(conversation.id))
      return
    }
    openJobs(conversation.id, conversation.title ?? 'Conversation')
  }, [jobsEntryVisible, closeRailEntry, openJobs, conversation.id, conversation.title])

  // The rail's browser preview follows the conversation without ever taking it
  // over: the entry is kept current, and opening it stays the person's move.
  useBrowserPreview(conversation.id, conversation.title ?? 'Conversation', live.items)

  // The sign on the desktop that Studio is at the keyboard, up for exactly as
  // long as this turn is driving the computer. Its Stop ends the run here.
  useComputerIndicator(conversation.id, live.items, running, stopTurn)

  return (
    <div data-attachment-drop-zone className="relative flex h-full flex-col">
      <div
        ref={viewport}
        onScroll={onScroll}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        // Paging and arrowing are scrolling too. Without this the keyboard was
        // the one way to leave the bottom that the follow would silently undo.
        onKeyDown={onKeyDown}
        className="studio-scroll-inset studio-no-anchor min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className="mx-auto w-full"
          style={{
            maxWidth: SHELL.measure,
            paddingInline: SHELL.gutter,
            paddingTop: SHELL.topStrip.height + 20,
            paddingBottom: 20,
          }}
        >
          {/* The open, between this page and the scroll hook (see "The
              open" in `useAutoScroll`). While the replay is still coming, or
              the words have come but the minimum wait has not passed, the
              wait stands in the empty page and the words are laid out
              unseen, with the viewport already landed at their bottom. Then
              the wait fades and the words rise into place where they are -
              keyed to the conversation, so every open reveals and not only
              the first. No journey from the top: every paced version of one
              read as a page leaving as it arrived, or finished and then
              leaving. */}
          {!revealed && !hasWords ? null : (
            <motion.div
              key={conversation.id}
              initial={{ opacity: 0, y: 12 }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT }}
            >
              <LiveTranscript
                items={items}
                pending={gallery ? null : live.pending}
                phase={gallery ? { status: 'idle' } : live.phase}
                viewport={viewport}
                conversationId={conversation.id}
                compacting={compactingHere}
                onBranch={gallery ? undefined : onBranch}
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* `pointer-events-none` matters: a gradient laid over the transcript
          that swallowed clicks would silently make the last line of a reply
          unselectable. */}
      {/* Solid for the strip's own height, then a short fade below it.

          It used to be one gradient the whole way down, which meant the band
          holding the identity line was already partly transparent — so a line
          of the transcript sliding underneath showed *through* the project
          name and branch. Two pieces of text occupying the same pixels is not
          a soft edge, it is a collision, and it is worst exactly when the page
          is moving and the eye is trying to read the title.

          The fade still exists; it just starts where the chrome ends. Below
          the strip there is nothing to protect, so text can dissolve into the
          surface the way it should. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-surface"
        style={{ height: SHELL.topStrip.height }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 z-20 h-5 bg-gradient-to-b from-surface to-transparent"
        style={{ top: SHELL.topStrip.height }}
      />
      {/* The open's wait, in the empty page. Out of the flow, over the
          words that are laid out but not yet shown, so its leaving moves
          nothing under it.

          No `initial={false}` here, and that is load-bearing. The phase
          machine opens in `attaching`, so the wait is present on this
          component's very first render -- and a first-render child of an
          `AnimatePresence initial={false}` mounts with the presence context
          saying the initial animation is over, which blocks the entering
          animation of the whole subtree. The wait then snapped in at full
          opacity, SHOW_AFTER included, and because its later renders hand
          Framer the very keyframes it mounted with, nothing ever looked
          changed: the dots stood at their rest pose for the whole wait.
          (Every other `initial={false}` in the app gates a child that
          arrives on a later render, where the entrance plays.) */}
      <AnimatePresence>
        {!revealed && (live.phase.status === 'attaching' || hasWords) ? (
          <TranscriptWait
            key="loading"
            className="absolute inset-x-0 z-10 flex justify-center py-24"
            style={{ top: SHELL.topStrip.height + 20 }}
          />
        ) : null}
      </AnimatePresence>

      <div className="relative shrink-0">
        {/* Behind the composer, not over it.

            Without the stacking order stated, the fade painted on top of the
            field's upper edge — the composer's outline is a 1px ring in its
            box-shadow, and a gradient laid over it ate the top of that ring.
            The field looked like it had three sides. The fade's job is to
            dissolve the *transcript*, so it belongs under everything the
            composer draws. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-full z-0 h-10 bg-gradient-to-t from-surface to-transparent"
        />

        {/* The floating layer: chrome that belongs above the composer without
            belonging to it.

            Both of these used to be placed separately - the jump button
            pinned a fixed distance above this wrapper, the plan pill in
            normal flow inside the composer's own opaque block. The pill being
            in flow is what made the composer's top edge march up the window
            as the field grew: five image thumbnails pushed the whole slab,
            pill included, and the hard line where that slab met the
            transcript came with it.

            Out of flow and stacked instead. The column is anchored to the top
            of the composer, so it rides just above whatever height the field
            currently is, and the composer can grow underneath without moving
            anything through the layout. Stacking them together is also what
            keeps them from colliding: two separately positioned centred
            capsules overlapped by about ten pixels once both were showing.

            `pointer-events-none` on the column so the transcript behind it
            stays reachable in the gaps; each child takes its own events back. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex flex-col items-center gap-2 pb-3">
          {/* Only offered once the reader has scrolled away. Shown permanently
              it is a button that does nothing most of the time. */}
          <AnimatePresence>
            {!pinned ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                onClick={scrollToBottom}
                aria-label="Jump to latest"
                className="studio-blur pointer-events-auto flex size-8 items-center justify-center rounded-full border shadow-lifted"
              >
                <Icons.jumpToLatest />
              </motion.button>
            ) : null}
          </AnimatePresence>

          {/* Nearest the composer, because it describes the run the composer
              is feeding. It only describes it - an approval or a question
              blocks the run, and those stay in the flow below where the
              layout gives them weight. */}
          {/* Both pills sit here for the same reason: they describe the run
              the composer is feeding without blocking it. The commands come
              second because the plan is what the run says it is doing, and a
              process it left behind is a footnote to that. */}
          {!gallery && (plan.hasPlan || jobs.jobs.length > 0) ? (
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 px-4">
              {plan.snapshot !== null && plan.hasPlan ? (
                <PlanPill
                  snapshot={plan.snapshot}
                  items={plan.items}
                  open={planEntryVisible}
                  onToggle={togglePlanPanel}
                />
              ) : null}
              {jobs.jobs.length > 0 ? (
                <JobsPill
                  jobs={jobs.jobs}
                  open={jobsEntryVisible}
                  onToggle={toggleJobsPanel}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {gallery ? null : (
          <div
            className="relative z-10 mx-auto w-full bg-surface pb-4"
            style={{ maxWidth: SHELL.measure, paddingInline: SHELL.gutter }}
          >
            <ConnectionNotice
              phase={live.phase}
              onResume={live.resume}
              refused={live.refused}
              onDismissRefusal={live.dismissRefusal}
            />
            {attachRefusal !== null ? (
              <SendRefusal failure={attachRefusal} onDismiss={() => setAttachRefusal(null)} />
            ) : null}
            {approvals.questions.length > 0 ? (
              <div className="mb-3">
                <ApprovalPrompt
                  // Keyed by the active question, so answering one and
                  // moving to the next remounts the card. Without it the
                  // duration chosen for the previous question stays
                  // selected, and a person who granted "Always" once would
                  // find the next question already set to "Always" - a
                  // wider consent than they were asked for, preselected by
                  // an answer they gave about something else.
                  key={approvals.questions[0]?.id}
                  questions={approvals.questions}
                  answeringId={approvals.answeringId}
                  onAnswer={approvals.answer}
                  hasProject={conversation.projectId !== null}
                />
              </div>
            ) : null}
            {questions.rows.length > 0 ? (
              <div className="mb-3">
                <QuestionPrompt
                  // Keyed the same way, and for the same reason: a
                  // selection made for one question must never be found
                  // still holding when the next one is on screen.
                  key={questions.rows[0]?.id}
                  rows={questions.rows}
                  answeringId={questions.answeringId}
                  onAnswer={questions.answer}
                  onStop={questions.stop}
                />
              </div>
            ) : null}
            {approvals.answeredElsewhere !== null ? (
              <AnsweredElsewhere sentence={approvals.answeredElsewhere} />
            ) : null}
            {questions.answeredElsewhere !== null ? (
              <AnsweredElsewhere sentence={questions.answeredElsewhere} />
            ) : null}

            {queue.error ? <p role="alert" className="mb-2 text-sm text-muted-foreground">{queue.error}</p> : null}
            <QueuedMessages messages={queue.messages} disabled={queue.changing} onAction={(message, action) => { void queue.change(message, action) }} />
            <Composer
              conversationId={conversation.id}
              queueFull={queue.messages.length >= 3}
              restoredMessage={queue.restoredMessage}
              // A queued follow-up does not answer the tool's question. Keep
              // that distinction visible while the answer holds the run.
              placeholder={
                approvals.questions.length > 0 || questions.rows.length > 0
                  ? 'Answer above, or queue a follow-up'
                  : isTurnRunning(live.phase)
                    ? 'Queue a follow-up'
                    : 'Reply'
              }
              onSend={sendTurn}
              onQueue={(text, images, documents) => sendTurn(text, images, documents, 'queue')}
              // Admitted counts. A turn the harness has taken but not yet
              // started producing is still a turn: the words are gone, the
              // stop control is the only thing that can call it back, and on
              // the real provider that window has been most of the turn's
              // length. Reading `streaming` alone is what left the composer
              // idle for six of a seven-second turn.
              busy={isTurnRunning(live.phase)}
              onStop={stopTurn}
            />
          </div>
        )}
      </div>
    </div>
  )
}
