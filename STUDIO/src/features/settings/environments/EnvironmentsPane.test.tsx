/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentsPane } from './EnvironmentsPane'
import type { EnvironmentsView } from './useEnvironments'
import type { FolderTrust, SandboxScopeRow } from '@/platform/harness'

/**
 * The two holes Task 57 left in this pane, and the words around them.
 *
 * A machine-wide grant could be taken away but never given, and with no
 * projects on the machine the whole pane was read-only. Both halves are
 * pinned here, together with the rule that the control says which scope it
 * is writing at the moment of the click.
 */

const environments = vi.hoisted(() => {
  return {
    // The assertion widens this seed to the whole view union, so the `view`
    // field accepts the ready shapes the tests assign later. The rule reads
    // the expression alone and calls it unnecessary; removing it fails the
    // typecheck, which is the evidence that settles it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    view: { status: 'loading' } as EnvironmentsView,
    refreshing: false,
    lastError: null as string | null,
    refresh: vi.fn(async () => {}),
    selectProject: vi.fn(async (_id: string | null) => {}),
    setLevel: vi.fn(async () => null),
    grantCustom: vi.fn(async () => null),
    revoke: vi.fn(async () => null),
    setTrust: vi.fn(async () => null),
  }
})

vi.mock('@/features/settings/environments/useEnvironments', () => ({
  useEnvironments: () => environments,
}))

afterEach(cleanup)

// Call assertions are per test. The hoisted mocks would otherwise carry one
// test's calls into the next, and a machine-wide assertion could pass on a
// project-scoped call an earlier test happened to make.
beforeEach(() => {
  vi.clearAllMocks()
})

const GIT = 'C:\\Program Files\\Git'

function scopeRow(path: string, projectId: string): SandboxScopeRow {
  return {
    projectId,
    path,
    mode: 'read',
    source: 'custom',
    presetId: null,
    grantedAt: 1_000,
  }
}

function ready(scope: {
  readonly project?: readonly SandboxScopeRow[]
  readonly machineWide?: readonly SandboxScopeRow[]
  readonly trust?: readonly FolderTrust[]
}): void {
  environments.view = {
    status: 'ready',
    projects: [
      {
        id: 'prj_a',
        name: 'Ada',
        icon: 'arc',
        description: '',
        folders: [],
        createdAt: 1_000,
      },
    ],
    projectId: 'prj_a',
    scope: {
      project: scope.project ?? [],
      machineWide: scope.machineWide ?? [],
      level: 'contained',
      trust: scope.trust ?? [],
    },
  }
}

function noProjects(): void {
  environments.view = {
    status: 'ready',
    projects: [],
    projectId: null,
    scope: { project: [], machineWide: [], level: 'contained', trust: [] },
  }
}

describe('EnvironmentsPane', () => {
  it('offers grant controls with no project on the machine, as machine-wide', () => {
    noProjects()
    render(<EnvironmentsPane />)

    // The custom path is grantable, and the only scope there is to grant is
    // machine-wide.
    expect(screen.getByRole('button', { name: 'Grant everywhere' })).not.toBeNull()
    expect(screen.getByLabelText('Absolute path')).not.toBeNull()
    expect(screen.getByText('No project selected')).not.toBeNull()
    // No project means no level to choose.
    expect(screen.queryByRole('radiogroup', { name: "This project's level" })).toBeNull()
    // And no scope chooser, because there is nothing to choose between.
    expect(screen.queryByRole('radiogroup', { name: 'Grants below apply to' })).toBeNull()
  })

  it('names the project as the scope at the moment of the click, and grants there', () => {
    ready({})
    render(<EnvironmentsPane />)

    fireEvent.change(screen.getByLabelText('Absolute path'), {
      target: { value: 'C:\\Tools\\data' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Grant for this project' }))
    expect(environments.grantCustom).toHaveBeenCalledWith('prj_a', 'C:\\Tools\\data', 'read')
  })

  it('grants a custom path machine-wide from the same choice', () => {
    ready({})
    render(<EnvironmentsPane />)

    fireEvent.change(screen.getByLabelText('Absolute path'), {
      target: { value: 'C:\\Tools\\data' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Everywhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Grant everywhere' }))
    expect(environments.grantCustom).toHaveBeenCalledWith('', 'C:\\Tools\\data', 'read')
  })

  it('lists a machine-wide grant with its source, and removes it machine-wide', () => {
    ready({ machineWide: [scopeRow(GIT, '')] })
    render(<EnvironmentsPane />)

    expect(screen.getByText('read · custom · everywhere')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(environments.revoke).toHaveBeenCalledWith('', GIT)
  })

  it('removes a project grant for the project, not machine-wide', () => {
    ready({ project: [scopeRow(GIT, 'prj_a')] })
    render(<EnvironmentsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(environments.revoke).toHaveBeenCalledWith('prj_a', GIT)
  })
})

/**
 * The gate nobody could answer.
 *
 * `workspace_trust` was read before every policy rule and written by nothing,
 * so a conversation in a project folder could only read, in every permission
 * mode. This section is where an existing project answers it.
 */
describe('folder trust', () => {
  const FOLDER: FolderTrust = { root: 'C:\\Work\\alpha', name: 'alpha', decision: 'undecided' }

  it('says plainly why the project can only read, and takes the answer', () => {
    ready({ trust: [FOLDER] })
    render(<EnvironmentsPane />)

    expect(screen.getByText('This project can only read')).toBeTruthy()
    // Scoped to the folder's own group: the level control below offers a
    // `Trusted` of its own, and the two answers are not the same question.
    const group = screen.getByRole('radiogroup', { name: 'Trust alpha' })
    fireEvent.click(within(group).getByRole('radio', { name: 'Trusted' }))

    expect(environments.setTrust).toHaveBeenCalledWith(FOLDER.root, true)
  })

  it('drops the warning once every folder is vouched for', () => {
    ready({ trust: [{ ...FOLDER, decision: 'trusted' }] })
    render(<EnvironmentsPane />)

    expect(screen.queryByText('This project can only read')).toBeNull()
  })
})
