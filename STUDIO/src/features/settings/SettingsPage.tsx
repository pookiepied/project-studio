import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { SHELL, VIEW_TRANSITION } from '@/design/tokens'
import { AppearancePane } from '@/features/settings/panes/AppearancePane'
import { ArchivePane } from '@/features/settings/panes/ArchivePane'
import { GeneralPane } from '@/features/settings/panes/GeneralPane'
import { PlaceholderPane } from '@/features/settings/panes/Pane'
import { ProvidersPane } from '@/features/settings/panes/ProvidersPane'
import { SETTINGS_GROUPS, findSection } from '@/features/settings/sections'

/**
 * Settings, as one page.
 *
 * ---- Why there is no section rail ----------------------------------------
 *
 * There used to be one, and it was a second sidebar: opening Settings put a
 * nav column next to the nav column already there, so the window held two
 * lists of destinations at once and neither was obviously the one in charge.
 * Two sidebars is not a layout, it is an unresolved question about where
 * navigation lives.
 *
 * So the app keeps exactly one, and it goes on showing conversations. Settings
 * is a document you scroll, which suits it: these are twenty small groups of
 * controls, not twenty places to be. Scrolling past the ones you did not want
 * costs nothing and shows you what exists -- a rail hides every section except
 * the one you already knew to click.
 *
 * A section route still works. It scrolls that section into view instead of
 * swapping the pane, so a link from the command palette lands somewhere real
 * and the surrounding context stays visible.
 */
/** Where Settings opens when no particular section was asked for. */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)

  useEffect(() => {
    // Opening Settings plainly should land at the top, on the page's own title.
    // Scrolling unconditionally meant the first section was pushed to the top of
    // the viewport the instant the page mounted, so the heading you navigated to
    // was never visible and the page appeared to open halfway down itself.
    if (!section || section.id === DEFAULT_SECTION) return
    const target = scroller.current?.querySelector(`#settings-${section.id}`)
    if (!target) return
    // `auto` rather than `smooth`: arriving at a settings section is a jump, and
    // animating a long scroll makes the destination feel further away.
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [section])

  return (
    <div
      ref={scroller}
      className="studio-scroll-inset h-full min-h-0 overflow-y-auto"
      style={{ paddingTop: SHELL.topStrip.height + 16 }}
    >
      <motion.div {...VIEW_TRANSITION} className="mx-auto w-full px-8 pb-24" style={{ maxWidth: SHELL.measure }}>
        <h1 className="studio-display text-foreground">Settings</h1>

        {SETTINGS_GROUPS.map((group) => (
          <section key={group.id} className="mt-10">
            <p className="text-micro text-muted-foreground/80 uppercase">{group.name}</p>

            <div className="mt-3 flex flex-col">
              {group.sections.map((item) => (
                <div
                  key={item.id}
                  id={`settings-${item.id}`}
                  // The offset keeps a scrolled-to heading clear of the top
                  // strip, which would otherwise sit on top of the thing you
                  // just navigated to.
                  className="scroll-mt-16 border-t py-7 first:border-t-0 first:pt-1"
                >
                  <Pane sectionId={item.id} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </motion.div>
    </div>
  )
}

function Pane({ sectionId }: { sectionId: string }) {
  switch (sectionId) {
    case 'general':
      return <GeneralPane />
    case 'appearance':
      return <AppearancePane />
    case 'archive':
      return <ArchivePane />
    case 'providers':
      return <ProvidersPane />
    case 'account':
      return (
        <PlaceholderPane
          title="Account"
          description="Who you are signed in as."
          items={['Signed-in account', 'Sign out', 'Where credentials are stored on this machine']}
        />
      )
    case 'voice':
      return (
        <PlaceholderPane
          title="Voice"
          description="Dictation and spoken conversations."
          items={[
            'Input device and level',
            'Dictation language',
            'Voice for spoken replies',
            'Push to talk, or hands free',
          ]}
        />
      )
    case 'personalization':
      return (
        <PlaceholderPane
          title="Personalization"
          description="What Studio should know about you across every conversation."
          items={['How you want replies written', 'Standing context about your work', 'Saved memories']}
        />
      )
    case 'shortcuts':
      return (
        <PlaceholderPane
          title="Keyboard shortcuts"
          description="Every shortcut, and how to change it."
          items={['Search and commands', 'New conversation', 'Toggle the sidebar', 'Send and stop']}
        />
      )
    case 'mcp':
      return (
        <PlaceholderPane
          title="MCP servers"
          description="Servers that give Studio new tools."
          items={[
            'Installed servers, each on or off per project',
            'Whether a server needs a network',
            'The tools a server exposes',
            'Add a server by command or URL',
          ]}
        />
      )
    case 'connectors':
      return (
        <PlaceholderPane
          title="Connectors"
          description="Accounts and services Studio can reach."
          items={['Connected accounts', 'What each connector may read or write', 'Add a connector']}
        />
      )
    case 'browser-use':
      return (
        <PlaceholderPane
          title="Browser and computer use"
          description="Letting Studio drive a browser or the desktop."
          items={['Which browser to drive', 'Sites that are always refused', 'Screenshot permission']}
        />
      )
    case 'skills':
      return (
        <PlaceholderPane
          title="Skills"
          description="Packaged instructions for a kind of task."
          items={['Installed skills, on or off', 'What triggers each one', 'Add a skill from a folder']}
        />
      )
    case 'hooks':
      return (
        <PlaceholderPane
          title="Hooks"
          description="Commands that run around the agent's actions."
          items={['Before and after a tool call', 'On session start and end', 'Enable or disable each hook']}
        />
      )
    case 'git':
      return (
        <PlaceholderPane
          title="Git"
          description="How Studio works with repositories."
          items={['Default branch behaviour', 'Whether to commit automatically', 'Signing']}
        />
      )
    case 'worktrees':
      return (
        <PlaceholderPane
          title="Worktrees"
          description="Isolated checkouts for parallel work."
          items={['Existing worktrees', 'Where new ones are created', 'Cleaning up unchanged worktrees']}
        />
      )
    case 'environments':
      return (
        <PlaceholderPane
          title="Environments"
          description="Where commands actually run."
          items={['Local, container, or remote', 'Environment variables per project', 'Sandbox profile']}
        />
      )
    default:
      return <GeneralPane />
  }
}
