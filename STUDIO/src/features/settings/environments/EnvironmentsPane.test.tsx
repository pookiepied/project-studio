/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentsPane } from './EnvironmentsPane'
import type { EnvironmentsView } from './useEnvironments'
import type { FolderTrust, IsolationInfo, SandboxScopeRow, ShellInfo } from '@/platform/harness'

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
    setShell: vi.fn(async () => null),
    setIsolation: vi.fn(async () => null),
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
    grantedAt: 1_000,
  }
}

const BASH = { kind: 'bash', label: 'bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' } as const
const CMD = { kind: 'cmd', label: 'cmd', path: 'C:\\Windows\\System32\\cmd.exe' } as const

function shellInfo(overrides: Partial<ShellInfo> = {}): ShellInfo {
  return { preferred: null, active: { kind: BASH.kind, path: BASH.path }, available: [BASH, CMD], ...overrides }
}

/** A Windows build: nothing to turn on. The Linux states override this. */
function isolationInfo(overrides: Partial<IsolationInfo> = {}): IsolationInfo {
  return { enabled: false, offered: false, backend: null, shortfall: [], ...overrides }
}

function ready(scope: {
  readonly project?: readonly SandboxScopeRow[]
  readonly machineWide?: readonly SandboxScopeRow[]
  readonly trust?: readonly FolderTrust[]
  readonly shell?: ShellInfo
  readonly isolation?: IsolationInfo
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
    shell: scope.shell ?? shellInfo(),
    isolation: scope.isolation ?? isolationInfo(),
  }
}

function noProjects(): void {
  environments.view = {
    status: 'ready',
    projects: [],
    projectId: null,
    scope: { project: [], machineWide: [], level: 'contained', trust: [] },
    shell: shellInfo(),
    isolation: isolationInfo(),
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
    // No project means no reach to choose.
    expect(screen.queryByRole('radiogroup', { name: 'What this project can reach' })).toBeNull()
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
 * The shell is the person's shell (ADR 0057).
 */
describe('the shell', () => {
  it('offers the shells the machine has behind Automatic, and names the one in effect', () => {
    ready({})
    render(<EnvironmentsPane />)

    const group = screen.getByRole('radiogroup', { name: 'Shell' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Automatic',
      'bash',
      'cmd',
    ])
    expect(screen.getByText(/Commands run through bash at C:\\Program Files/)).toBeTruthy()
    expect(screen.getByText(/Automatic picks the first shell found/)).toBeTruthy()

    fireEvent.click(within(group).getByRole('radio', { name: 'cmd' }))
    expect(environments.setShell).toHaveBeenCalledWith('cmd')
  })

  it('hands the choice back to the machine through Automatic', () => {
    ready({ shell: shellInfo({ preferred: 'cmd', active: { kind: 'cmd', path: CMD.path } }) })
    render(<EnvironmentsPane />)

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Shell' })).getByRole('radio', { name: 'Automatic' }))
    expect(environments.setShell).toHaveBeenCalledWith(null)
  })

  it('says when the chosen shell is not on this machine, and which one answers instead', () => {
    // A preference kept from another machine, or from before an uninstall:
    // the page must not pretend it is in effect, and must not throw it away.
    ready({ shell: shellInfo({ preferred: 'pwsh' }) })
    render(<EnvironmentsPane />)

    expect(screen.getByText(/PowerShell 7 was chosen, but this machine does not have it\. Commands run through bash/)).toBeTruthy()
  })
})

/**
 * The sandbox fence is the person's to turn on (ADR 0057), where the build
 * has one to offer.
 */
describe('the sandbox fence', () => {
  it('offers no switch where the platform has no fence, and says why', () => {
    ready({})
    render(<EnvironmentsPane />)

    expect(screen.queryByRole('radiogroup', { name: 'Sandbox fence' })).toBeNull()
    expect(screen.getByText(/no sandbox fence for this platform/)).toBeTruthy()
  })

  it('offers the switch where a fence exists, and turns it on', () => {
    ready({ isolation: isolationInfo({ offered: true }) })
    render(<EnvironmentsPane />)

    expect(screen.getByText(/^Off\. Commands run under the permission gate alone/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Sandbox fence' })).getByRole('radio', { name: 'On' }))
    expect(environments.setIsolation).toHaveBeenCalledWith(true)
  })

  it('names the backend when the fence is on and working', () => {
    ready({ isolation: isolationInfo({ offered: true, enabled: true, backend: 'bwrap' }) })
    render(<EnvironmentsPane />)

    expect(screen.getByText(/On, through bwrap\./)).toBeTruthy()
  })

  it("says the machine cannot supply the fence, in the machine's own words", () => {
    // The state stock Ubuntu lands in: the switch is on and the kernel says
    // no. The page must not pretend the fence is up.
    ready({
      isolation: isolationInfo({ offered: true, enabled: true, shortfall: ['Install bubblewrap.'] }),
    })
    render(<EnvironmentsPane />)

    expect(screen.getByText(/this machine cannot supply it.*Install bubblewrap\./)).toBeTruthy()
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
    // Scoped to the folder's own group: the reach control below is another
    // question with its own answers, and the two must not be confused.
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
