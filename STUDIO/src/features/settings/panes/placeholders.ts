/**
 * Sections whose layout is settled and whose values are not yet wired.
 *
 * Data, not JSX, and in their own file for one reason: they were a two-hundred
 * line `switch` inside the settings page, so the page could not be read without
 * scrolling past the contents of every section it might show. A page's job is
 * layout and navigation. What is *in* a section is the section's business.
 *
 * Each entry says what will live there rather than showing an empty frame,
 * because a blank pane is indistinguishable from one that failed to load.
 */

export interface Placeholder {
  readonly title: string
  readonly description: string
  readonly items: readonly string[]
}

export const PLACEHOLDERS: Readonly<Record<string, Placeholder>> = {
  account: {
    title: 'Account',
    description: 'Who you are signed in as.',
    items: ['Signed-in account', 'Sign out', 'Where credentials are stored on this machine'],
  },
  personalization: {
    title: 'Personalization',
    description: 'What Studio should know about you across every conversation.',
    items: ['How you want replies written', 'Standing context about your work', 'Saved memories'],
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    description: 'Every shortcut, and how to change it.',
    items: ['Search and commands', 'New conversation', 'Toggle the sidebar', 'Send and stop'],
  },
  // `mcp` is not here any more: the pane is built, and `registry.tsx` prefers
  // a built pane over a placeholder. A placeholder for a section that renders
  // is a description of the software that nothing can ever show.
  connectors: {
    title: 'Connectors',
    description: 'Accounts and services Studio can reach.',
    items: ['Connected accounts', 'What each connector may read or write', 'Add a connector'],
  },
  'browser-use': {
    title: 'Browser and computer use',
    description: 'Letting Studio drive a browser or the desktop.',
    items: ['Which browser to drive', 'Sites that are always refused', 'Screenshot permission'],
  },
  hooks: {
    title: 'Hooks',
    description: "Commands that run around the agent's actions.",
    items: ['Before and after a tool call', 'On session start and end', 'Enable or disable each hook'],
  },
  git: {
    title: 'Git',
    description: 'How Studio works with repositories.',
    items: ['Default branch behaviour', 'Whether to commit automatically', 'Signing'],
  },
  worktrees: {
    title: 'Worktrees',
    description: 'Isolated checkouts for parallel work.',
    items: ['Existing worktrees', 'Where new ones are created', 'Cleaning up unchanged worktrees'],
  },
}
