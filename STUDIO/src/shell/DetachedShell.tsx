import { SHELL } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { windowFrame } from '@/shell/chrome/windowFrame'
import { ChatPage } from '@/features/chat'
import { VoiceModeProvider } from '@/features/voice'
import { startWindowDrag } from '@/platform/tauri'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { useWorkspace } from '@/stores/workspace'
import { useRail } from '@/stores/rail'
import { SideRail } from '@/features/rail'

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
  const rail = useRail()
  const conversation = conversations.find((item) => item.id === conversationId)

  if (!conversation) return <Missing />

  const frame = windowFrame()

  return (
    <div
      className={cn('relative flex h-full w-full overflow-hidden bg-surface', frame.className)}
      style={frame.style}
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
            {rail.collapsed ? <button type="button" aria-label="Open conversation workspace" onClick={rail.expand} className="rounded-lg px-2 py-1 text-caption text-muted-foreground hover:bg-tint">Workspace</button> : null}
            <TurnMenu />
          </div>
        </header>

        <ChatPage conversation={conversation} />
      </div>
      <SideRail key={conversationId} open={rail.open} />
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
  const frame = windowFrame()
  return (
    <div
      className={cn('flex h-full w-full items-center justify-center bg-surface', frame.className)}
      style={frame.style}
    >
      <p className="text-ui text-muted-foreground">This conversation is no longer available.</p>
    </div>
  )
}
