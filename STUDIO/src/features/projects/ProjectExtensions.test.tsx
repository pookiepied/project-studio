/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectExtensions } from './ProjectExtensions'
import type { McpServers, McpView } from '@/features/settings/mcp/useMcpServers'
import type { Skills, SkillsView } from '@/features/settings/skills/useSkills'
import type { HarnessFailure, McpServerRecord, SkillRecord } from '@/platform/harness'

/**
 * The project's own decisions, as they land on the screen.
 *
 * The pinned facts are the ones the project scope exists to keep: Inherit
 * reads as Inherit while the default decides, and says what it resolves to;
 * an answered choice travels to the hook as `null` or a boolean, never
 * something in between; a harness without readings keeps the row quiet
 * rather than inventing an effect; and a refused write says so. The hook is
 * a double because the wire and the parsing are proven elsewhere; what this
 * file pins is what the person is SHOWN, which is where a dishonest row
 * would actually do its damage.
 */

const useMcpServers = vi.hoisted(() => vi.fn())
const useSkills = vi.hoisted(() => vi.fn())

vi.mock('@/features/settings/mcp/useMcpServers', () => ({ useMcpServers }))
vi.mock('@/features/settings/skills/useSkills', () => ({ useSkills }))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  // The skills half answers empty unless a case says otherwise, so every
  // server case renders the screen as it did before skills joined it.
  skillsHooked({ status: 'ready', listing: { skills: [], problems: [] } })
})

function skill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: 'review-pr',
    title: 'review-pr',
    description: 'Reviews a pull request.',
    provenance: 'user',
    directory: 'C:\\skills\\review-pr',
    enabledByDefault: false,
    ...overrides,
  }
}

function skillsHooked(
  view: SkillsView,
  setEnabled: Skills['setEnabled'] = vi.fn(async () => null),
): void {
  useSkills.mockReturnValue({
    view,
    refreshing: false,
    refresh: vi.fn(async () => {}),
    setEnabled,
  })
}

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'echo-server',
    title: 'Echo server',
    description: 'Echoes the supplied text',
    provenance: 'user',
    transport: 'stdio',
    command: 'C:\\tools\\node.exe',
    args: ['server.js'],
    env: {},
    needsNetwork: false,
    auth: 'none',
    enabledByDefault: false,
    ...overrides,
  }
}

function hooked(
  view: McpView,
  setEnabled: McpServers['setEnabled'] = vi.fn(async () => null),
): void {
  useMcpServers.mockReturnValue({
    view,
    refreshing: false,
    refresh: vi.fn(async () => {}),
    save: vi.fn(async () => null),
    remove: vi.fn(async () => null),
    setEnabled,
    setCredential: vi.fn(async () => null),
    clearCredential: vi.fn(async () => null),
  })
}

const ready = (servers: readonly McpServerRecord[]): McpView => ({ status: 'ready', servers })

describe('the project extensions section', () => {
  it('asks both hooks for this project, and only this project', () => {
    hooked(ready([]))
    render(<ProjectExtensions projectId="prj_1" />)

    expect(useMcpServers).toHaveBeenCalledWith({ projectId: 'prj_1' })
    expect(useSkills).toHaveBeenCalledWith({ projectId: 'prj_1' })
  })

  it('decides about a skill with the same row, at the skill hook', async () => {
    // The second kind, on the same screen. The row reads the skill's own
    // project reading, and its decision travels to the skill hook - never
    // to the server one - as the same three answers.
    const setSkillEnabled = vi.fn(async () => null)
    hooked(ready([]))
    skillsHooked(
      {
        status: 'ready',
        listing: {
          skills: [skill({ project: { decision: null, resolved: true, decidedAt: 'global' } })],
          problems: [],
        },
      },
      setSkillEnabled,
    )
    render(<ProjectExtensions projectId="prj_1" />)

    const group = screen.getByRole('radiogroup', { name: 'review-pr in this project' })
    expect(within(group).getByRole('radio', { name: 'Inherit' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.getByText('Inherits the default, which has it on.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Off' }))
    })
    expect(setSkillEnabled).toHaveBeenCalledWith('review-pr', false)
  })

  it('reads Inherit as Inherit while the default decides, and says what that means', () => {
    // The flattening proof, one screen up from the control. The default has
    // this server on and the project has said nothing; the row must show a
    // third answer, must not read as Off, and - because "Inherit" alone
    // would still be a mystery - must say what it currently resolves to.
    hooked(
      ready([
        record({ project: { decision: null, resolved: true, decidedAt: 'global' } }),
      ]),
    )
    render(<ProjectExtensions projectId="prj_1" />)

    const group = screen.getByRole('radiogroup', { name: 'Echo server in this project' })
    expect(within(group).getByRole('radio', { name: 'Inherit' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(within(group).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(screen.getByText('Inherits the default, which has it on.')).toBeTruthy()
  })

  it('sends the third value when the project goes back to inheriting', async () => {
    const setEnabled = vi.fn(async () => null)
    hooked(ready([record({ project: { decision: true, resolved: true, decidedAt: 'project' } })]), setEnabled)
    render(<ProjectExtensions projectId="prj_1" />)

    const group = screen.getByRole('radiogroup', { name: 'Echo server in this project' })
    // Awaited, because each click also settles the write's `then`, which
    // renders the section again - and a continuation left running past the
    // test would race the next one's render.
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Off' }))
    })
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Inherit' }))
    })

    // Off, then the third answer. A second `false` here would be the control
    // having only two hands, and the project would have no way back to the
    // default's decision.
    expect(setEnabled).toHaveBeenNthCalledWith(1, 'echo-server', false)
    expect(setEnabled).toHaveBeenNthCalledWith(2, 'echo-server', null)
  })

  it('keeps a row with no reading quiet about the effect', () => {
    // A harness older than the readings: the control still reads Inherit,
    // because that is what the record says, but there is nothing honest to
    // say about what it resolves to, so the row says nothing rather than
    // guessing.
    hooked(ready([record()]))
    render(<ProjectExtensions projectId="prj_1" />)

    const group = screen.getByRole('radiogroup', { name: 'Echo server in this project' })
    expect(within(group).getByRole('radio', { name: 'Inherit' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByText(/Inherits/)).toBeNull()
  })

  it('says when the harness refused a change', async () => {
    const failure: HarnessFailure = { kind: 'not-reachable', message: 'The harness is not running.', timedOut: false }
    hooked(ready([record({ project: { decision: true, resolved: true, decidedAt: 'project' } })]), vi.fn(async () => failure))
    render(<ProjectExtensions projectId="prj_1" />)

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Echo server in this project' })).getByRole(
        'radio',
        { name: 'Off' },
      ),
    )

    await waitFor(() => expect(screen.getByText('The harness refused that change.')).toBeTruthy())
  })

  it('says when a change reaches the conversations that are already open', () => {
    // The sentence the discovery plan's recommendation hangs on: the switch
    // cannot say it, and it is the one thing a person toggling mid-project
    // needs to know about the conversation they may be picturing.
    hooked(ready([record({ project: { decision: null, resolved: true, decidedAt: 'global' } })]))
    render(<ProjectExtensions projectId="prj_1" />)

    expect(
      screen.getByText(/applies the new decision the next time it sends/),
    ).toBeTruthy()
    expect(screen.getByText(/does not change/)).toBeTruthy()
  })
})
