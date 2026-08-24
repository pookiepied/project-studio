import { SHELL } from '@/design/tokens'
import { ChatPage } from '@/features/chat'
import { VoiceModeProvider } from '@/features/voice'
import { startWindowDrag } from '@/platform/tauri'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'

/**
 * One conversation, in a window of its own.
 *
 * ---- What it is not ------------------------------------------------------
 *
 * Not a second app, and not a stripped copy of the shell. It is the same
 * `ChatPage`, the same composer, the same transcript and the same window
 * treatment — one rounded frame with the DWM corner, the traffic lights, the
 * drag region. A detached window that rendered its own lighter transcript
 * would drift from the real one within a week, and the first thing anyone
 * would notice is that a feature works in one window and not the other.
 *
 * What it drops is navigation, and only navigation: no sidebar, no palette, no
 * project or settings routes. This window is *about* one conversation, so
 * there is nowhere else in it to go, and offering a way out would make it a
 * second main window rather than a detached view.
 *
 * The identity line stays, because it names what you are looking at and a
 * window with no title is one you cannot pick out of a task switcher. The turn
 * settings stay, because the composer is here and they belong to the next
 * message — which is the same rule the main window follows.
 */
export function DetachedShell({ conversationId }: { conversationId: string }) {
  const { conversations } = useWorkspace()
  const detach = useDetachConversation()
  const conversation = conversations.find((item) => item.id === conversationId)

  if (!conversation) return <Missing />

  // A fork is a new conversation, and this window is about one. The default —
  // navigating in place — is invisible here, because this shell renders the
  // conversation it was opened for and no route. So a fork gets what any new
  // conversation deserves: a window of its own.
  const openFork = (forkId: string) => {
    const forked = conversations.find((item) => item.id === forkId)
    detach(forkId, forked?.title ?? 'Untitled')
  }

  return (
    <div
      className="relative flex h-full w-full overflow-hidden border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      {/* Same stage, same place, as the studio window: over everything this
          window holds, clipped by its rounded frame. See `AppShell`. */}
      <VoiceModeProvider>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <header
          onPointerDown={(event) => {
            // Same contract as the sidebar's brand band: dragging goes through
            // `startWindowDrag` rather than `data-tauri-drag-region`, whose
            // double-click maximize squares the DWM corner. The target guard
            // keeps the strip's controls clickable — the drag belongs to the
            // empty header, never to a child of it.
            if (event.button !== 0 || event.target !== event.currentTarget) return
            void startWindowDrag()
          }}
          className="absolute inset-x-0 top-0 z-30 flex items-center gap-1"
          style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
        >
          <TrafficLights />

          <div className="@container pointer-events-none absolute inset-x-0 flex justify-center">
            <div className="pointer-events-auto flex min-w-0 max-w-[62%] justify-center">
              <IdentityLine conversation={conversation} />
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <TurnMenu />
          </div>
        </header>

        <ChatPage conversation={conversation} onForked={openFork} />
      </div>
      </VoiceModeProvider>
    </div>
  )
}

/**
 * The conversation is gone.
 *
 * Reachable in one real way: the window was open when the conversation was
 * deleted in the main one. Saying so plainly beats an empty transcript, which
 * would read as a loading state that never resolves.
 */
function Missing() {
  return (
    <div
      className="flex h-full w-full items-center justify-center border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      <p className="text-ui text-muted-foreground">This conversation is no longer available.</p>
    </div>
  )
}
