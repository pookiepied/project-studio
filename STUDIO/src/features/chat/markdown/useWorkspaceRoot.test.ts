import { describe, expect, it } from 'vitest'
import { conversationWorkspaceRoot } from './useWorkspaceRoot'

/**
 * Which folder a conversation's relative paths stand in. The lookup is the
 * whole answer to "resolve against the workspace of THIS conversation, not
 * some other one", so it is pinned directly: two conversations, two
 * projects, no cross-talk.
 */
describe('conversationWorkspaceRoot', () => {
  const conversations = [
    { id: 'cnv-alpha', projectId: 'proj-one' },
    { id: 'cnv-beta', projectId: 'proj-two' },
    { id: 'cnv-bare', projectId: null },
  ]
  const projects = [
    { id: 'proj-one', folders: [{ path: 'C:\\Work\\One' }, { path: 'C:\\Work\\One-extra' }] },
    { id: 'proj-two', folders: [{ path: 'C:\\Work\\Two' }] },
  ]

  it('stands each conversation in its own project primary folder', () => {
    expect(conversationWorkspaceRoot('cnv-alpha', conversations, projects)).toBe('C:\\Work\\One')
    expect(conversationWorkspaceRoot('cnv-beta', conversations, projects)).toBe('C:\\Work\\Two')
  })

  it('uses the primary folder, not just any folder of the project', () => {
    expect(conversationWorkspaceRoot('cnv-alpha', conversations, projects)).not.toBe('C:\\Work\\One-extra')
  })

  it('knows nothing for a conversation without a project', () => {
    expect(conversationWorkspaceRoot('cnv-bare', conversations, projects)).toBeNull()
    expect(conversationWorkspaceRoot('cnv-unknown', conversations, projects)).toBeNull()
    expect(conversationWorkspaceRoot(null, conversations, projects)).toBeNull()
  })
})
