/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewProjectDialog } from './NewProjectDialog'
import type { HarnessFailure } from '@/platform/harness'
import type { Project, ProjectIcon } from '@/domain/projects/types'

/**
 * The folder the person actually picked.
 *
 * The five claims the task pins as testable, one each:
 *
 * 1. Cancelling the picker appends nothing and raises nothing -- changing
 *    your mind after opening a dialog is the most common outcome, not a
 *    failure.
 * 2. A picked directory becomes a folder named after its own last segment;
 *    the slug of the project name is never involved.
 * 3. A directory already picked is refused in the dialog, before any request
 *    is written -- the store would refuse it too, but the person should not
 *    need a round trip to learn it.
 * 4. Outside Tauri there is no picker, and the control says so instead of
 *    appending anything -- the fabricated path this dialog once invented is
 *    the bug, so there is no fallback to test for.
 * 5. A store refusal renders the harness's own sentence verbatim and the
 *    dialog stays open: a refused system directory names `trusted`, and
 *    paraphrasing it would lose the remedy.
 *
 * The last two tests are not from the task's list. The first pins the happy
 * path the refusal branch sits beside (close, then navigate to the project,
 * only once the write has actually landed). The second pins the guard for a
 * verdict arriving after the person gave up -- Escape does not wait for the
 * harness, and a write settling into a closed dialog must not navigate.
 *
 * What is NOT here, because vitest cannot see it: that the native dialog
 * actually opens, and that the capability grant is the narrow one. Both are
 * verified by hand against the running desktop app and written down in the
 * task report -- an over-broad grant passes every test a narrow one passes.
 */

const state = { tauri: true }
const pickDirectory = vi.fn<() => Promise<string | null>>()
const openProject = vi.fn()
const onClose = vi.fn()
const createProject = vi.fn<
  (input: {
    readonly name: string
    readonly icon: ProjectIcon
    readonly description: string
    readonly folders: readonly { readonly name: string; readonly path: string }[]
  }) => { project: Project; written: Promise<HarnessFailure | null> }
>()

vi.mock('@/platform/tauri', () => ({
  isTauri: () => state.tauri,
  pickDirectory: () => pickDirectory(),
}))
vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ openProject }) }))
const trustFolders = vi.fn<(paths: readonly string[]) => Promise<HarnessFailure | null>>(() =>
  Promise.resolve(null),
)
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ createProject, trustFolders }),
}))

/**
 * The sentence `systemScopeRefusal` writes for a Windows system directory,
 * word for word -- this is the text the dialog must show untouched.
 */
const REFUSAL: HarnessFailure = {
  kind: 'harness-error',
  status: 400,
  message:
    'That path is inside the Windows system directory (C:\\Windows), and granting it would ' +
    'end containment rather than widen it. Use trusted for this project instead.',
}

function projectFrom(input: {
  name: string
  icon: ProjectIcon
  description: string
  folders: readonly { name: string; path: string }[]
}): Project {
  return {
    id: 'prj_test',
    name: input.name,
    icon: input.icon,
    description: input.description,
    folders: input.folders.map((folder, index) => ({ id: `src_${index}`, ...folder })),
    branch: 'main',
    branches: ['main'],
    createdAt: 0,
  }
}

function createProjectWriting(written: Promise<HarnessFailure | null>) {
  createProject.mockImplementation((input) => ({
    project: projectFrom(input),
    written,
  }))
}

function renderDialog() {
  return render(<NewProjectDialog open onClose={onClose} />)
}

function fillName(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Quiet Hours'), { target: { value } })
}

/** Opens the picker through the control and answers it with `path`. */
async function pick(path: string | null) {
  pickDirectory.mockResolvedValueOnce(path)
  fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
}

afterEach(() => {
  cleanup()
  // Reset, not clear: a test whose click never reaches the picker (the
  // out-of-Tauri one) leaves a queued once-answer behind, and a clear would
  // let it leak into the next test's pick.
  vi.resetAllMocks()
  state.tauri = true
})

describe('the folder the person actually picked', () => {
  it('appends nothing and raises nothing when the picker is cancelled', async () => {
    renderDialog()
    await pick(null)
    // One macrotask so the picker's answer has fully settled before judging
    // what landed -- a waitFor on the empty hint would otherwise resolve on
    // the first poll, before a wrongly-appended row could displace it.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('A project needs at least one folder to work in.')).toBeTruthy()
    expect(screen.queryByText('A project cannot attach the same folder twice.')).toBeNull()
    expect(screen.queryByText('The folder picker needs the desktop app.')).toBeNull()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('names a folder after the last segment of the picked directory', async () => {
    renderDialog()

    await pick('C:\\Users\\pooki\\Dev Workspace\\Project Studio')
    expect(await screen.findByText('Project Studio')).toBeTruthy()
    expect(screen.getByText('C:\\Users\\pooki\\Dev Workspace\\Project Studio')).toBeTruthy()

    // A trailing separator does not name the folder after the empty string.
    await pick('D:\\Work\\alpha\\')
    expect(await screen.findByText('alpha')).toBeTruthy()
  })

  it('refuses a directory already picked before any request', async () => {
    renderDialog()

    await pick('D:\\Work\\alpha')
    expect(await screen.findByText('alpha')).toBeTruthy()

    // Windows paths are case-insensitive, so the store would refuse this
    // one too; the dialog says so first.
    await pick('D:\\work\\ALPHA')
    expect(await screen.findByText('A project cannot attach the same folder twice.')).toBeTruthy()
    expect(screen.getAllByText('alpha')).toHaveLength(1)
    expect(screen.queryByText('ALPHA')).toBeNull()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('says it needs the desktop app outside Tauri and appends nothing', async () => {
    state.tauri = false
    renderDialog()

    await pick('C:\\never-asked-for')

    expect(await screen.findByText('The folder picker needs the desktop app.')).toBeTruthy()
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(screen.getByText('A project needs at least one folder to work in.')).toBeTruthy()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('renders the harness refusal sentence verbatim and stays open', async () => {
    createProjectWriting(Promise.resolve(REFUSAL))
    renderDialog()
    fillName('Kernel Tools')
    await pick('C:\\Windows\\Fonts')
    // The submit button is disabled until the picked row exists, so the row
    // has to be on screen before the click means anything.
    expect(await screen.findByText('Fonts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText(REFUSAL.message)).toBeTruthy()
    expect(screen.getByText('The harness refused that folder.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
  })

  it('writes the trust answer for the folders, only when it was given', async () => {
    // The bug this exists for: trust was a gate nobody could answer, so a
    // project's conversations could only ever read. The dialog is where the
    // person is looking at the folder, so it is where the answer is taken.
    createProjectWriting(Promise.resolve(null))
    renderDialog()
    fillName('Quiet Hours')
    await pick('C:\\Users\\pooki\\work\\quiet')
    expect(await screen.findByText('quiet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Unanswered is not "no": nothing is written, and Environments still asks.
    expect(trustFolders).not.toHaveBeenCalled()
  })

  it('vouches for the picked folders when the person says so', async () => {
    createProjectWriting(Promise.resolve(null))
    renderDialog()
    fillName('Quiet Hours')
    await pick('C:\\Users\\pooki\\work\\quiet')
    expect(await screen.findByText('quiet')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'I trust these folders' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(trustFolders).toHaveBeenCalled())
    expect(trustFolders).toHaveBeenCalledWith(['C:\\Users\\pooki\\work\\quiet'])
  })

  it('closes and opens the project once the write lands', async () => {
    createProjectWriting(Promise.resolve(null))
    renderDialog()
    fillName('Quiet Hours')
    await pick('C:\\Users\\pooki\\work\\quiet')
    expect(await screen.findByText('quiet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(openProject).toHaveBeenCalledWith('prj_test')
  })

  it('does not navigate when the dialog closed before the write settled', async () => {
    let settle: (refusal: HarnessFailure | null) => void = () => {}
    createProjectWriting(
      new Promise<HarnessFailure | null>((resolve) => {
        settle = resolve
      }),
    )
    const view = renderDialog()
    fillName('Quiet Hours')
    await pick('C:\\Users\\pooki\\work\\quiet')
    expect(await screen.findByText('quiet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    // The person gives up while the write is in flight. The verdict that
    // arrives afterwards is not theirs to see.
    view.rerender(<NewProjectDialog open={false} onClose={onClose} />)
    settle(null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(openProject).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
