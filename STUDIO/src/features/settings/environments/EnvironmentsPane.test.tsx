/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentsPane } from './EnvironmentsPane'
import type { EnvironmentsView } from './useEnvironments'
import type { SandboxScopeRow } from '@/platform/harness'

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
    view: { status: 'loading' } as EnvironmentsView,
    refreshing: false,
    lastError: null as string | null,
    refresh: vi.fn(async () => {}),
    selectProject: vi.fn(async (_id: string | null) => {}),
    setLevel: vi.fn(async () => null),
    grantPreset: vi.fn(async () => null),
    grantCustom: vi.fn(async () => null),
    revoke: vi.fn(async () => null),
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
    source: 'preset',
    presetId: 'git',
    grantedAt: 1_000,
  }
}

function ready(scope: {
  readonly project?: readonly SandboxScopeRow[]
  readonly machineWide?: readonly SandboxScopeRow[]
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
    },
    presets: [
      {
        id: 'git',
        title: 'Git',
        description: 'The Git installation.',
        paths: [{ path: GIT, mode: 'read' }],
      },
    ],
  }
}

function noProjects(): void {
  environments.view = {
    status: 'ready',
    projects: [],
    projectId: null,
    scope: { project: [], machineWide: [], level: 'contained' },
    presets: [
      {
        id: 'git',
        title: 'Git',
        description: 'The Git installation.',
        paths: [{ path: GIT, mode: 'read' }],
      },
    ],
  }
}

describe('EnvironmentsPane', () => {
  it('offers grant controls with no project on the machine, as machine-wide', () => {
    noProjects()
    render(<EnvironmentsPane />)

    // The preset path and the custom path are both grantable, and the only
    // scope there is to grant is machine-wide.
    expect(screen.getAllByRole('button', { name: 'Grant everywhere' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Absolute path')).not.toBeNull()
    expect(screen.getByText('No project selected')).not.toBeNull()
    // No project means no level to choose.
    expect(screen.queryByRole('radiogroup', { name: "This project's level" })).toBeNull()
    // And no scope chooser, because there is nothing to choose between.
    expect(screen.queryByRole('radiogroup', { name: 'Grants below apply to' })).toBeNull()
  })

  it('grants a preset machine-wide when no project is selected', async () => {
    noProjects()
    render(<EnvironmentsPane />)

    // Two machine-wide grant buttons are on screen (the preset's and the
    // custom path's); the first is the preset's.
    const [presetGrant] = screen.getAllByRole('button', { name: 'Grant everywhere' })
    if (presetGrant === undefined) throw new Error('No machine-wide grant button.')
    fireEvent.click(presetGrant)
    expect(environments.grantPreset).toHaveBeenCalledWith('', 'git', GIT, 'read')
  })

  it('names the project as the scope at the moment of the click, and grants there', () => {
    ready({})
    render(<EnvironmentsPane />)

    // The preset path's button: presets render above the custom-path field,
    // so its grant button is the first with this name.
    const [presetGrant] = screen.getAllByRole('button', { name: 'Grant for this project' })
    if (presetGrant === undefined) throw new Error('No project grant button.')
    fireEvent.click(presetGrant)
    expect(environments.grantPreset).toHaveBeenCalledWith('prj_a', 'git', GIT, 'read')
  })

  it('switching the scope to everywhere grants machine-wide instead', () => {
    ready({})
    render(<EnvironmentsPane />)

    fireEvent.click(screen.getByRole('radio', { name: 'Everywhere' }))
    const [presetGrant] = screen.getAllByRole('button', { name: 'Grant everywhere' })
    if (presetGrant === undefined) throw new Error('No machine-wide grant button.')
    fireEvent.click(presetGrant)
    // The empty project id is the machine-wide scope.
    expect(environments.grantPreset).toHaveBeenCalledWith('', 'git', GIT, 'read')
  })

  it('grants a custom path machine-wide from the same choice', () => {
    // The preset path already carries a machine-wide row, so the only
    // "Grant everywhere" button on screen is the custom path's.
    ready({ machineWide: [scopeRow(GIT, '')] })
    render(<EnvironmentsPane />)

    fireEvent.change(screen.getByLabelText('Absolute path'), {
      target: { value: 'C:\\Tools\\data' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Everywhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Grant everywhere' }))
    expect(environments.grantCustom).toHaveBeenCalledWith('', 'C:\\Tools\\data', 'read')
  })

  it('says where a path is granted, and revokes it where it lives', () => {
    ready({ machineWide: [scopeRow(GIT, '')] })
    render(<EnvironmentsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Granted everywhere (revoke)' }))
    expect(environments.revoke).toHaveBeenCalledWith('', GIT)
  })

  it('revokes a project grant for the project, not machine-wide', () => {
    ready({ project: [scopeRow(GIT, 'prj_a')] })
    render(<EnvironmentsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Granted for this project (revoke)' }))
    expect(environments.revoke).toHaveBeenCalledWith('prj_a', GIT)
  })

  it('says so when a path is granted at both scopes, and takes both up', () => {
    ready({ project: [scopeRow(GIT, 'prj_a')], machineWide: [scopeRow(GIT, '')] })
    render(<EnvironmentsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Granted here and everywhere (revoke)' }))
    expect(environments.revoke).toHaveBeenCalledWith('prj_a', GIT)
    expect(environments.revoke).toHaveBeenCalledWith('', GIT)
  })
})
