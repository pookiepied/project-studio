import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented } from '@/components/primitives'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { StateNote } from '@/components/state/StateNote'
import { useEnvironments } from '@/features/settings/environments/useEnvironments'
import type { FolderTrust, SandboxLevel } from '@/platform/harness'

// A JSX string attribute is not escaped, so the two backslashes written
// here would both reach the input. Held as a value instead.
const CUSTOM_PATH_PLACEHOLDER = 'C:\\Tools\\data'

/**
 * Environments.
 *
 * Where commands actually run. Five parts, in this order: whether the
 * project's folders are vouched for at all, this project's level, the scope
 * the next grant will take, the detected toolchains, and everything granted
 * with where it came from. Scope and level are kept apart here the same way
 * they are kept apart everywhere else: granting a path never changes a level.
 *
 * Trust comes first because it is the precondition the other three sit
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
          presets={view.presets}
          lastError={environments.lastError}
          refreshing={environments.refreshing}
          onRefresh={() => void environments.refresh()}
          onSelectProject={(id) => void environments.selectProject(id)}
          onSetLevel={(id, level) => void environments.setLevel(id, level)}
          onSetTrust={(root, trusted) => void environments.setTrust(root, trusted)}
          onGrantPreset={(id, presetId, path, mode) => void environments.grantPreset(id, presetId, path, mode)}
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
  presets,
  lastError,
  refreshing,
  onRefresh,
  onSelectProject,
  onSetLevel,
  onSetTrust,
  onGrantPreset,
  onRevoke,
  onGrantCustom,
}: {
  projects: readonly { readonly id: string; readonly name: string }[]
  projectId: string | null
  scope: { readonly project: readonly { readonly path: string; readonly mode: string; readonly source: string; readonly presetId: string | null }[]; readonly machineWide: readonly { readonly path: string; readonly mode: string; readonly source: string; readonly presetId: string | null }[]; readonly level: SandboxLevel; readonly trust: readonly FolderTrust[] }
  presets: readonly { readonly id: string; readonly title: string; readonly description: string; readonly paths: readonly { readonly path: string; readonly mode: 'read' | 'write' }[] }[]
  lastError: string | null
  refreshing: boolean
  onRefresh: () => void
  onSelectProject: (id: string | null) => void
  onSetLevel: (id: string, level: SandboxLevel) => void
  onSetTrust: (root: string, trusted: boolean) => void
  onGrantPreset: (id: string, presetId: string, path: string, mode: 'read' | 'write') => void
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

  const covers = (rows: readonly { readonly path: string }[], path: string): boolean =>
    rows.some((row) => row.path.toLowerCase() === path.toLowerCase())

  const grantedHere = (path: string): boolean =>
    projectId !== null && covers(scope.project, path)
  const grantedEverywhere = (path: string): boolean => covers(scope.machineWide, path)

  const revokeCovering = (path: string): void => {
    // The label says where a path is granted; the click takes up exactly
    // what it named, wherever the covering rows are.
    if (projectId !== null && grantedHere(path)) onRevoke(projectId, path)
    if (grantedEverywhere(path)) onRevoke('', path)
  }

  const presetButtonLabel = (path: string): string => {
    const here = grantedHere(path)
    const wide = grantedEverywhere(path)
    if (here && wide) return 'Granted here and everywhere (revoke)'
    if (here) return 'Granted for this project (revoke)'
    if (wide) return 'Granted everywhere (revoke)'
    return grantEverywhere ? 'Grant everywhere' : 'Grant for this project'
  }

  const pressPresetButton = (presetId: string, path: string, mode: 'read' | 'write'): void => {
    if (grantedHere(path) || grantedEverywhere(path)) {
      revokeCovering(path)
      return
    }
    // `projectId ?? ''` only ever falls through when the grant is
    // machine-wide by construction, where the id is the empty string anyway.
    onGrantPreset(grantEverywhere ? '' : (projectId ?? ''), presetId, path, mode)
  }

  return (
    <div>
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
          label="This project's level"
          hint={
            scope.level === 'trusted'
              ? 'Trusted: the project\u2019s own files are no longer the boundary. Commands run uncontained.'
              : 'Contained: commands can read and write the project and what is granted below, and nothing else.'
          }
        >
          <Segmented
            layoutId="settings-sandbox-level"
            ariaLabel="This project's level"
            value={scope.level}
            onChange={(value) => onSetLevel(projectId, value)}
            options={[
              { id: 'contained', label: 'Contained' },
              { id: 'trusted', label: 'Trusted' },
            ]}
          />
        </Row>
      )}

      {projectId !== null && scope.level === 'trusted' ? (
        <StateNote
          title="Trusted removes the wall"
          detail="Docker and the walk-up class live here, not in the list below. A Docker path preset would be a containment bypass wearing a preset's clothes: if this project needs Docker, trusted is the choice, stated in those words."
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
        <p className="text-ui text-foreground">Detected toolchains</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Only what is actually on this machine, with the path found. A preset that is not detected is not shown. Grant one to the scope chosen above, or machine-wide when no project is selected.
        </p>
        {presets.length === 0 ? (
          <p className="mt-2 text-caption text-muted-foreground">
            None of the eight toolchains were found. We look for Git, Rust, Node caches, Python, Java, Android and Flutter, Go, and .NET.
          </p>
        ) : null}
        {presets.map((preset) => (
          <div key={preset.id} className="mt-3 rounded-md border p-3">
            <p className="text-ui text-foreground">{preset.title}</p>
            <p className="text-caption text-muted-foreground">{preset.description}</p>
            {preset.paths.map((entry) => (
              <div key={entry.path} className="mt-2 flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption text-foreground">{entry.path}</p>
                  <p className="text-caption text-muted-foreground">{entry.mode}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => pressPresetButton(preset.id, entry.path, entry.mode)}
                >
                  {presetButtonLabel(entry.path)}
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>

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
          An absolute path that exists. Volume roots and system directories are refused — a grant there is the end of containment, and the project that wants that wants trusted instead.
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
