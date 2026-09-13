import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { visionRefusal } from '@/domain/attachments/images'
import { Composer } from '@/features/chat/composer'
import { AnsweredElsewhere } from '@/features/chat/AnsweredElsewhere'
import { useForkConversation } from '@/features/chat/fork'
import { useAutoScroll } from '@/features/chat/transcript'
import { galleryItems } from '@/features/chat/transcript/galleryItems'
import { ConnectionNotice, SendRefusal } from '@/features/chat/transcript/live/ConnectionNotice'
import { LiveTranscript } from '@/features/chat/transcript/live/LiveTranscript'
import { useConversationTranscript } from '@/features/chat/useConversationTranscript'
import { isTurnRunning } from '@/features/chat/useConversation'
import { ApprovalPrompt } from '@/features/chat/permissions/ApprovalPrompt'
import { usePendingApprovals } from '@/features/chat/permissions/usePendingApprovals'
import { QuestionPrompt } from '@/features/chat/questions/QuestionPrompt'
import { usePendingQuestions } from '@/features/chat/questions/usePendingQuestions'
import { PlanPill } from '@/features/plans/PlanPill'
import { usePlan } from '@/features/plans/usePlan'
import { JobsPill } from '@/features/jobs/JobsPill'
import { useBackgroundJobs } from '@/features/jobs/useBackgroundJobs'
import { jobsEntryId, planEntryId, useRail } from '@/stores/rail'
import { useBrowserPreview } from '@/features/chat/useBrowserPreview'
import { GALLERY_CONVERSATION_ID } from '@/domain/session/gallery'
import { contextReport } from '@/domain/session/context'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type MeasuredContextUsage,
} from '@/platform/harness'
import { effectiveTurnSettings } from '@/domain/session/settings'
import { turnSettingsToWire } from '@/platform/harness'
import { useWorkspace } from '@/stores/workspace'
import type { SeamFailure, TurnImageWire } from '@/platform/harness'
import type { Conversation } from '@/domain/session/types'

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
export function ChatPage({ conversation }: { conversation: Conversation }) {
  const { touch, settings, catalog, markRunning, markContextReport } = useWorkspace()
  const gallery = conversation.id === GALLERY_CONVERSATION_ID

  const live = useConversationTranscript(conversation.id)
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
  const [measuredContext, setMeasuredContext] = useState<MeasuredContextUsage | null>(null)
  const running = isTurnRunning(live.phase)
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
  }, [gallery, conversation.id, running])

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

  const { viewport, pinned, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom } =
    useAutoScroll(items, conversation.id)

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
    async (text: string, images: readonly TurnImageWire[]) => {
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
        const sent = await live.submit(text, turnSettingsToWire(effective), images)
        if (sent.ok) touch(conversation.id)
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
    [conversation, catalog.models, live.submit, settings, touch],
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

  return (
    <div className="relative flex h-full flex-col">
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
          <LiveTranscript
            items={items}
            pending={gallery ? null : live.pending}
            phase={gallery ? { status: 'idle' } : live.phase}
            viewport={viewport}
            conversationId={conversation.id}
            onBranch={gallery ? undefined : onBranch}
          />
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

            <Composer
              conversationId={conversation.id}
              // While a question holds the run, the field must not invite a new
              // message: the turn is stopped, and what the page is waiting for
              // is the answer above, not more words.
              placeholder={
                approvals.questions.length > 0 || questions.rows.length > 0
                  ? 'Waiting for your answer above'
                  : 'Reply'
              }
              onSend={sendTurn}
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
