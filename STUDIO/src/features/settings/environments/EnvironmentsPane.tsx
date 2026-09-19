import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented } from '@/components/primitives'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { StateNote } from '@/components/state/StateNote'
import { useEnvironments } from '@/features/settings/environments/useEnvironments'
import type { FolderTrust, IsolationInfo, SandboxLevel, SandboxScopeRow, ShellInfo, ShellKind } from '@/platform/harness'

// A JSX string attribute is not escaped, so the two backslashes written
// here would both reach the input. Held as a value instead.
const CUSTOM_PATH_PLACEHOLDER = 'C:\\Tools\\data'

/** What each interpreter kind is called on the page. */
const SHELL_NAMES: Record<ShellKind, string> = {
  bash: 'bash',
  pwsh: 'PowerShell 7',
  powershell: 'PowerShell 5.1',
  cmd: 'cmd',
  sh: 'sh',
}

/**
 * Environments.
 *
 * Where commands actually run. Six parts, in this order: the shell that
 * runs them, the sandbox fence under the permission gate, whether the
 * project's folders are vouched for at all, this project's reach, the scope
 * the next grant will take, and everything granted with where it came from. The detected-toolchain presets that used
 * to sit between the last two went with the Windows container (ADR 0057):
 * they named the folders a container had to be let into, and with no
 * container the machine's own PATH answers. Scope and reach are kept apart
 * here the same way they are kept apart everywhere else: granting a path
 * never changes the reach.
 *
 * "Reach" is the page's word for what the harness stores as the level
 * (`contained` / `trusted`). The stored words described an OS container,
 * and since ADR 0057 there is none on Windows: what the level decides now is
 * whether the project's folder plus the grants below are the boundary the
 * file tools stop at - anything outside becomes a question - or whether the
 * whole machine is in reach without one. The ids on the wire are unchanged;
 * only the words a person reads are.
 *
 * The shell comes first because it is machine-wide and every command on the
 * page below runs through it. The choice is the person's (ADR 0057): the
 * harness orders what the machine has, and this is where that order is
 * overruled. The fence is beside it for the same reason: machine-wide, off
 * until turned on, and only offered where this build has one - Linux. On
 * Windows the row says so and offers nothing, because a switch that does
 * nothing is worse than a sentence that says why.
 *
 * Trust comes next because it is the precondition the other three sit
 * behind. An unvouched folder refuses every write and every command in every
 * permission mode, so a person reading this pane top to bottom meets the
 * answer that explains the refusal before they meet the controls that cannot
 * fix it.
 *
 * Grants can be written at both scopes the harness keeps - for the selected
 * project, or machine-wide (every project and conversations with no project).
 * The choice is a control on the surface, and every grant button names the
 * scope it is writing at the moment of the click. With no project on the
 * machine only machine-wide is available, so the controls stay usable rather
 * than disappearing behind a project that does not exist.
 */
export function EnvironmentsPane() {
  const environments = useEnvironments()
  const view = environments.view

  return (
    <Pane
      title="Environments"
      description="Where commands actually run. Local only: containers and remote machines are not in this task."
    >
      {view.status === 'loading' ? <StateNote title="Reading environments" detail="Asking the harness what this machine has." /> : null}
      {view.status === 'no-harness' ? <StateNote title="Harness not running" detail="Start Studio and this page will fill in." /> : null}
      {view.status === 'failed' ? <StateNote title="Could not read environments" detail={view.error.message} /> : null}
      {view.status === 'ready' ? (
        <Body
          projects={view.projects}
          projectId={view.projectId}
          scope={view.scope}
          shell={view.shell}
          isolation={view.isolation}
          lastError={environments.lastError}
          refreshing={environments.refreshing}
          onRefresh={() => void environments.refresh()}
          onSelectProject={(id) => void environments.selectProject(id)}
          onSetLevel={(id, level) => void environments.setLevel(id, level)}
          onSetShell={(kind) => void environments.setShell(kind)}
          onSetIsolation={(enabled) => void environments.setIsolation(enabled)}
          onSetTrust={(root, trusted) => void environments.setTrust(root, trusted)}
          onRevoke={(id, path) => void environments.revoke(id, path)}
          onGrantCustom={(id, path, mode) => void environments.grantCustom(id, path, mode)}
        />
      ) : null}
    </Pane>
  )
}

function Body({
  projects,
  projectId,
  scope,
  shell,
  isolation,
  lastError,
  refreshing,
  onRefresh,
  onSelectProject,
  onSetLevel,
  onSetShell,
  onSetIsolation,
  onSetTrust,
  onRevoke,
  onGrantCustom,
}: {
  projects: readonly { readonly id: string; readonly name: string }[]
  projectId: string | null
  scope: {
    readonly project: readonly SandboxScopeRow[]
    readonly machineWide: readonly SandboxScopeRow[]
    readonly level: SandboxLevel
    readonly trust: readonly FolderTrust[]
  }
  shell: ShellInfo
  isolation: IsolationInfo
  lastError: string | null
  refreshing: boolean
  onRefresh: () => void
  onSelectProject: (id: string | null) => void
  onSetLevel: (id: string, level: SandboxLevel) => void
  onSetShell: (kind: ShellKind | null) => void
  onSetIsolation: (enabled: boolean) => void
  onSetTrust: (root: string, trusted: boolean) => void
  onRevoke: (id: string, path: string) => void
  onGrantCustom: (id: string, path: string, mode: 'read' | 'write') => void
}) {
  const [customPath, setCustomPath] = useState('')
  const [customMode, setCustomMode] = useState<'read' | 'write'>('read')
  const [customError, setCustomError] = useState<string | null>(null)
  // The scope the next grant click will write. A machine-wide grant applies
  // to every project and to conversations with no project, which is more
  // than most people mean by "allow this", so the choice stays on the
  // surface and every button names the one it is doing. With no project on
  // the machine there is nothing to choose: grants can only be machine-wide.
  const [grantScope, setGrantScope] = useState<'project' | 'everywhere'>('project')
  const grantEverywhere = projectId === null || grantScope === 'everywhere'

  // What the shell row says under its control. The preference and the shell
  // in effect are the same thing until the preference names a shell this
  // machine does not have, and then the row says which one answers instead.
  const shellHint = (): string => {
    if (shell.active === null) return 'This machine has no command interpreter the shell tool can run.'
    const active = `Commands run through ${SHELL_NAMES[shell.active.kind]} at ${shell.active.path}.`
    if (shell.preferred !== null && shell.preferred !== shell.active.kind) {
      return `${SHELL_NAMES[shell.preferred]} was chosen, but this machine does not have it. ${active}`
    }
    if (shell.preferred === null) return `${active} Automatic picks the first shell found, in the order shown.`
    return active
  }

  // What the fence row says. Three states the harness reports, and the
  // page must not blur them: not offered on this platform (nothing to turn
  // on), on and working (the backend named), on and not working (the
  // machine's own reason, so the person can fix it or leave it).
  const fenceHint = (): string => {
    if (!isolation.offered) {
      return 'This build has no sandbox fence for this platform. Commands run under the permission gate, which asks before anything runs; that is the boundary here.'
    }
    if (!isolation.enabled) {
      return 'Off. Commands run under the permission gate alone. Turn the fence on to also wall each command into the project and what is granted below.'
    }
    if (isolation.backend !== null) {
      return `On, through ${isolation.backend}. Each command is walled into the project and what is granted below.`
    }
    return `On, and this machine cannot supply it, so commands run under the permission gate alone. ${isolation.shortfall.join(' ')}`
  }

  return (
    <div>
      <Row label="Shell" hint={shellHint()}>
        <Segmented
          layoutId="settings-shell"
          ariaLabel="Shell"
          value={shell.preferred ?? 'auto'}
          onChange={(value) => onSetShell(value === 'auto' ? null : value)}
          options={[
            { id: 'auto' as const, label: 'Automatic' },
            ...shell.available.map((entry) => ({ id: entry.kind, label: SHELL_NAMES[entry.kind] })),
          ]}
        />
      </Row>

      <Row label="Sandbox fence" hint={fenceHint()}>
        {isolation.offered ? (
          <Segmented
            layoutId="settings-sandbox-fence"
            ariaLabel="Sandbox fence"
            value={isolation.enabled ? 'on' : 'off'}
            onChange={(value) => onSetIsolation(value === 'on')}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'on', label: 'On' },
            ]}
          />
        ) : null}
      </Row>

      <div className="flex items-center justify-between py-3.5">
        <p className="text-ui text-muted-foreground">
          {projects.length === 0 ? 'No projects yet' : 'One project at a time'}
        </p>
        <IconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
          <Icons.reload />
        </IconButton>
      </div>

      {projects.length > 0 ? (
        <Row
          label="Project"
          hint="Scope attaches to a project id. Machine-wide grants apply everywhere, including conversations with no project."
        >
          <select
            aria-label="Project"
            value={projectId ?? ''}
            onChange={(event) => onSelectProject(event.target.value === '' ? null : event.target.value)}
            className="h-7 rounded-md border bg-surface px-2 text-ui text-foreground"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Row>
      ) : null}

      {projectId !== null && scope.trust.length > 0 ? (
        <>
          <Row
            label="Folders this project works in"
            hint="Vouching for a folder is a separate answer from the permission mode, and it is asked once about the folder rather than per command. Until it is answered a conversation standing here can only read - opening a repository someone sent you is the ordinary way a machine runs instructions its owner never wrote."
          />
          {scope.trust.map((folder) => (
            <Row key={folder.root} label={folder.name} hint={folder.root}>
              <Segmented
                layoutId={`settings-folder-trust-${folder.root}`}
                ariaLabel={`Trust ${folder.name}`}
                value={folder.decision}
                onChange={(value) => onSetTrust(folder.root, value === 'trusted')}
                options={[
                  { id: 'trusted', label: 'Trusted' },
                  { id: 'untrusted', label: 'Not trusted' },
                ]}
              />
            </Row>
          ))}
          {scope.trust.some((folder) => folder.decision !== 'trusted') ? (
            <StateNote
              title="This project can only read"
              detail="A folder that is not trusted refuses every write and every command, whichever permission mode a conversation is set to. Answer above and the mode takes over from there."
            />
          ) : null}
        </>
      ) : null}

      {projectId === null ? (
        <Row
          label="No project selected"
          hint="Create a project to hold a level and per-project grants. Until then the grants below are machine-wide: they apply to every project and to conversations with no project."
        />
      ) : (
        <Row
          label="What this project can reach"
          hint={
            scope.level === 'trusted'
              ? 'The whole machine: the project\u2019s own files are no longer the boundary, and a path outside them is not asked about.'
              : 'The project and what is granted below. A path outside them becomes a question, and a yes becomes a grant in the list below.'
          }
        >
          <Segmented
            layoutId="settings-sandbox-level"
            ariaLabel="What this project can reach"
            value={scope.level}
            onChange={(value) => onSetLevel(projectId, value)}
            options={[
              { id: 'contained', label: 'Project and grants' },
              { id: 'trusted', label: 'Whole machine' },
            ]}
          />
        </Row>
      )}

      {projectId !== null && scope.level === 'trusted' ? (
        <StateNote
          title="The whole machine is in reach"
          detail="Every file on this machine can be read and written by this project's conversations without a question, in whichever mode. The permission mode still decides whether a write or a command asks first; this only removes the boundary a question would have named."
        />
      ) : null}

      {projectId !== null ? (
        <Row
          label="Grants below apply to"
          hint="Everywhere means every project and conversations with no project, which is more than most people mean by allowing a path. This project means only the project selected above."
        >
          <Segmented
            layoutId="settings-grant-scope"
            ariaLabel="Grants below apply to"
            value={grantScope}
            onChange={(value) => setGrantScope(value)}
            options={[
              { id: 'project', label: 'This project' },
              { id: 'everywhere', label: 'Everywhere' },
            ]}
          />
        </Row>
      ) : null}

      {lastError === null ? null : (
        <StateNote title="The harness refused that change" detail={lastError} />
      )}

      <div className="py-3.5">
        <p className="text-ui text-foreground">Everything granted, and where it came from</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Every row for this project and machine-wide, with its source. A question grant is the one you may not remember making.
        </p>
        {scope.project.length === 0 && scope.machineWide.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">Nothing granted beyond the workspace.</p>
        ) : null}
        {scope.project.map((row) => (
          <div key={`${row.path}`} className="mt-2 flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption text-foreground">{row.path}</p>
              <p className="text-caption text-muted-foreground">
                {row.mode} · {row.source}
                {projectId === null ? '' : ' · this project'}
              </p>
            </div>
            {projectId === null ? null : (
              <Button variant="secondary" size="sm" onClick={() => onRevoke(projectId, row.path)}>
                Remove
              </Button>
            )}
          </div>
        ))}
        {scope.machineWide.map((row) => (
          <div key={`wide:${row.path}`} className="mt-2 flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption text-foreground">{row.path}</p>
              <p className="text-caption text-muted-foreground">
                {row.mode} · {row.source} · everywhere
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => onRevoke('', row.path)}>
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="py-3.5">
        <p className="text-ui text-foreground">Custom path</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          An absolute path that exists. Volume roots and system directories are refused — a grant there is the whole machine by another name, and the project that wants that chooses it above instead.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label="Absolute path"
            value={customPath}
            onChange={(event) => {
              setCustomPath(event.target.value)
              setCustomError(null)
            }}
            placeholder={CUSTOM_PATH_PLACEHOLDER}
            className="h-7 min-w-0 flex-1 rounded-md border bg-surface px-2 text-ui text-foreground"
          />
          <Segmented
            layoutId="settings-scope-mode"
            ariaLabel="Mode"
            value={customMode}
            onChange={(value) => setCustomMode(value)}
            options={[
              { id: 'read', label: 'Read' },
              { id: 'write', label: 'Write' },
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (customPath.trim() === '') {
                setCustomError('A scope path is required.')
                return
              }
              // The empty project id is the machine-wide scope; the harness
              // takes it and the store keeps the row beside the project ones.
              onGrantCustom(grantEverywhere ? '' : (projectId ?? ''), customPath.trim(), customMode)
              setCustomPath('')
            }}
          >
            {grantEverywhere ? 'Grant everywhere' : 'Grant for this project'}
          </Button>
        </div>
        {customError ? <p className="mt-1 text-caption text-danger">{customError}</p> : null}
      </div>
    </div>
  )
}
