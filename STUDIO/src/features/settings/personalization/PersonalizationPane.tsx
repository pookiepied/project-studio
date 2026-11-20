import { useEffect, useMemo, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton, SearchField, Segmented, Switch, TextArea, TextField } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane, PaneSection, Row } from '@/features/settings/panes/Pane'
import { cn } from '@/lib/cn'
import { useOptionalWorkspace } from '@/stores/workspace/WorkspaceProvider'
import {
  MEMORY_KINDS,
  type MemoryDraft,
  type MemoryItem,
  type MemoryKind,
  type MemoryPriority,
  type MemoryProfile,
  type MemoryScope,
} from '@/platform/harness'
import { usePersonalization, type Personalization, type WriteOutcome } from './usePersonalization'

/**
 * Personalization: who the person is, and what Studio remembers about them.
 *
 * Three groups, top to bottom in the order a person meets them:
 *
 * - **Profile** - name, what to call them, a few lines about them and how
 *   they want replies written. Every new conversation starts with it.
 * - **Memory** - the one switch: whether new conversations are given the
 *   profile and memories at all. Saved memories stay either way.
 * - **Saved memories** - every memory, personal and per project, with
 *   search, add, edit, delete, and a select mode for batch priority and
 *   batch delete. The model saves through the same harness routes, so
 *   anything it remembered can be corrected here.
 */
export function PersonalizationPane() {
  const memory = usePersonalization()
  const { view } = memory

  return (
    <Pane title="Personalization" description="What Studio knows about you, in every conversation.">
      {view.status === 'loading' ? <Loading label="Loading personalization" /> : null}
      {view.status === 'no-harness' ? (
        <StateNote
          title="The harness is not running."
          detail="Your profile and memories are kept by the harness, so they cannot be read until it starts."
        />
      ) : null}
      {view.status === 'failed' ? <StateNote title="Personalization could not be read." detail={view.error.message} /> : null}
      {view.status === 'ready' ? (
        <>
          <ProfileSection profile={view.profile} onSave={memory.saveProfile} />
          <PaneSection title="Memory">
            <Row
              label="Use memory in new conversations"
              hint={
                view.settings.enabled
                  ? 'New conversations start with your profile, important memories and recent ones.'
                  : 'New conversations start without them. Saved memories are kept, and Studio can still search them.'
              }
            >
              <Switch
                label="Use memory in new conversations"
                checked={view.settings.enabled}
                onChange={(enabled) => void memory.setEnabled(enabled)}
              />
            </Row>
          </PaneSection>
          <MemoriesSection memory={memory} items={view.listing.items} total={view.listing.total} />
        </>
      ) : null}
    </Pane>
  )
}

const PROFILE_LABELS: readonly { field: keyof MemoryProfile; label: string; hint: string; long: boolean }[] = [
  { field: 'name', label: 'Name', hint: 'Your full name.', long: false },
  { field: 'preferredName', label: 'What should Studio call you?', hint: 'A first name or nickname.', long: false },
  { field: 'about', label: 'About you', hint: 'Your work, interests and anything Studio should keep in mind.', long: true },
  { field: 'replyStyle', label: 'How replies should be written', hint: 'Tone, length, format, language.', long: true },
]

function ProfileSection({
  profile,
  onSave,
}: {
  profile: MemoryProfile
  onSave: Personalization['saveProfile']
}) {
  const [draft, setDraft] = useState<MemoryProfile>(profile)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => setDraft(profile), [profile])
  const dirty = PROFILE_LABELS.some(({ field }) => draft[field] !== profile[field])

  const save = async () => {
    setSaving(true)
    const failure = await onSave(draft)
    setSaving(false)
    setNote(failure === null ? 'Saved.' : failure.message)
  }

  return (
    <PaneSection title="Profile" hint="Every new conversation starts with this. Studio can also update it when you tell it to.">
      {PROFILE_LABELS.map(({ field, label, hint, long }) => (
        <Row key={field} label={label} hint={hint}>
          {long ? (
            <TextArea value={draft[field]} rows={3} onChange={(value) => setDraft({ ...draft, [field]: value })} className="w-full" />
          ) : (
            <TextField value={draft[field]} ariaLabel={label} onChange={(value) => setDraft({ ...draft, [field]: value })} />
          )}
        </Row>
      ))}
      <div className="flex items-center justify-end gap-2 py-2">
        {note !== null && !dirty ? <span className="text-caption text-muted-foreground">{note}</span> : null}
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => setDraft(profile)}>
          Discard
        </Button>
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          Save profile
        </Button>
      </div>
    </PaneSection>
  )
}

const KIND_LABEL: Readonly<Record<MemoryKind, string>> = {
  fact: 'Fact',
  preference: 'Preference',
  instruction: 'Instruction',
  event: 'Event',
}

const PRIORITY_OPTIONS: readonly { id: MemoryPriority; label: string }[] = [
  { id: 3, label: 'High' },
  { id: 2, label: 'Normal' },
  { id: 1, label: 'Low' },
]

const SCOPE_FILTER: readonly { id: MemoryScope | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'personal', label: 'Personal' },
  { id: 'project', label: 'Projects' },
]

const NO_PROJECTS: readonly { readonly id: string; readonly name: string }[] = []

function priorityLabel(priority: MemoryPriority): string {
  return priority === 3 ? 'High' : priority === 1 ? 'Low' : 'Normal'
}

function outcomeNote(outcome: WriteOutcome, done: string): string {
  if (!outcome.ok) return outcome.error.message
  if (outcome.refused.length === 0) return done
  return outcome.refused.join(' ')
}

function MemoriesSection({ memory, items, total }: { memory: Personalization; items: readonly MemoryItem[]; total: number }) {
  // Names only: the harness owns which project a memory is filed under, and
  // a pane outside the workspace still lists, edits and deletes.
  const projects = useOptionalWorkspace()?.projects ?? NO_PROJECTS
  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const [editing, setEditing] = useState<MemoryItem | 'new' | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [note, setNote] = useState<string | null>(null)
  const { filter, setFilter } = memory

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const endSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const batchPriority = async (priority: MemoryPriority) => {
    const outcome = await memory.edit([...selected].map((id) => ({ id, priority })))
    setNote(outcomeNote(outcome, `Set ${String(selected.size)} to ${priorityLabel(priority).toLowerCase()} priority.`))
    endSelect()
  }
  const batchForget = async () => {
    const outcome = await memory.forget([...selected])
    setNote(outcomeNote(outcome, `Deleted ${String(selected.size)}.`))
    endSelect()
  }

  return (
    <PaneSection
      title="Saved memories"
      hint={`${String(total)} saved. High priority memories reach every new conversation; others while recent, and Studio searches the rest when they matter.`}
    >
      <div className="flex items-center gap-2 py-2">
        <Segmented
          options={SCOPE_FILTER}
          value={filter.scope ?? 'all'}
          onChange={(scope) => setFilter({ ...filter, scope: scope === 'all' ? null : scope })}
          ariaLabel="Scope"
          layoutId="memory-scope"
        />
        <div className="min-w-24 flex-1">
          <SearchField
            value={filter.query}
            onChange={(query) => setFilter({ ...filter, query })}
            placeholder="Search memories"
            ariaLabel="Search memories"
          />
        </div>
        <IconButton label="Select" onClick={() => (selecting ? endSelect() : setSelecting(true))} active={selecting}>
          <Icons.select />
        </IconButton>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          Add memory
        </Button>
      </div>

      {selecting ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-tint px-3 py-2">
          <span className="text-caption text-muted-foreground">{String(selected.size)} selected</span>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set(items.map((item) => item.id)))}>
            Select all
          </Button>
          <div className="flex-1" />
          {PRIORITY_OPTIONS.map((option) => (
            <Button key={option.id} variant="secondary" size="xs" disabled={selected.size === 0} onClick={() => void batchPriority(option.id)}>
              {option.label}
            </Button>
          ))}
          <Button variant="danger" size="xs" disabled={selected.size === 0} onClick={() => void batchForget()}>
            Delete {String(selected.size)}
          </Button>
        </div>
      ) : null}

      {note !== null ? <p className="py-1 text-caption text-muted-foreground">{note}</p> : null}

      {editing === 'new' ? (
        <MemoryEditor
          projects={projects}
          onCancel={() => setEditing(null)}
          onSubmit={async (draft) => {
            const outcome = await memory.save([draft])
            setNote(outcomeNote(outcome, 'Added.'))
            if (outcome.ok && outcome.refused.length === 0) setEditing(null)
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <p className="py-6 text-center text-ui text-muted-foreground">
          {filter.query !== '' || filter.scope !== null ? 'No memory matches.' : 'Nothing remembered yet.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) =>
            editing !== null && editing !== 'new' && editing.id === item.id ? (
              <li key={item.id} className="py-2">
                <MemoryEditor
                  item={item}
                  projects={projects}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (draft) => {
                    const outcome = await memory.edit([{ id: item.id, ...draft }])
                    setNote(outcomeNote(outcome, 'Saved.'))
                    if (outcome.ok && outcome.refused.length === 0) setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={item.id} className="flex items-start gap-2 py-2.5">
                {selecting ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected.has(item.id)}
                    aria-label={`Select ${item.content}`}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border',
                      selected.has(item.id) && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {selected.has(item.id) ? <Icons.check size="xs" /> : null}
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-ui text-foreground">{item.content}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {[
                      KIND_LABEL[item.kind],
                      `${priorityLabel(item.priority)} priority`,
                      item.scope === 'project' ? `Project: ${projectName.get(item.projectId ?? '') ?? 'removed project'}` : 'Personal',
                      item.author === 'model' ? 'Saved by Studio' : 'Added by you',
                      new Date(item.updatedAt).toLocaleDateString(),
                    ].join(' - ')}
                    {item.tags.length > 0 ? ` - ${item.tags.join(', ')}` : ''}
                  </p>
                </div>
                {selecting ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton label="Edit" onClick={() => setEditing(item)}>
                      <Icons.edit />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      onClick={() =>
                        void memory.forget([item.id]).then((outcome) => setNote(outcomeNote(outcome, 'Deleted.')))
                      }
                    >
                      <Icons.delete />
                    </IconButton>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </PaneSection>
  )
}

function MemoryEditor({
  item,
  projects,
  onCancel,
  onSubmit,
}: {
  item?: MemoryItem
  projects: readonly { readonly id: string; readonly name: string }[]
  onCancel: () => void
  onSubmit: (draft: MemoryDraft) => Promise<void>
}) {
  const [content, setContent] = useState(item?.content ?? '')
  const [kind, setKind] = useState<MemoryKind>(item?.kind ?? 'fact')
  const [priority, setPriority] = useState<MemoryPriority>(item?.priority ?? 2)
  const [scope, setScope] = useState<MemoryScope>(item?.scope ?? 'personal')
  const [projectId, setProjectId] = useState<string>(item?.projectId ?? projects[0]?.id ?? '')
  const [tags, setTags] = useState((item?.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const ready = content.trim() !== '' && (scope === 'personal' || projectId !== '')

  const submit = async () => {
    setBusy(true)
    await onSubmit({
      content: content.trim(),
      kind,
      priority,
      scope,
      projectId: scope === 'project' ? projectId : null,
      tags: tags.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''),
    })
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-tint p-3">
      <TextArea value={content} rows={2} placeholder="One short statement, e.g. Prefers metric units." onChange={setContent} className="w-full" />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={MEMORY_KINDS.map((id) => ({ id, label: KIND_LABEL[id] }))}
          value={kind}
          onChange={setKind}
          ariaLabel="Kind"
          layoutId={`memory-kind-${item?.id ?? 'new'}`}
        />
        <Segmented
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={setPriority}
          ariaLabel="Priority"
          layoutId={`memory-priority-${item?.id ?? 'new'}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={[
            { id: 'personal' as const, label: 'Personal' },
            { id: 'project' as const, label: 'Project' },
          ]}
          value={scope}
          onChange={setScope}
          ariaLabel="Applies to"
          layoutId={`memory-scope-${item?.id ?? 'new'}`}
        />
        {scope === 'project' ? (
          projects.length === 0 ? (
            <span className="text-caption text-muted-foreground">There are no projects yet.</span>
          ) : (
            <select
              aria-label="Project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="studio-control rounded-md border border-border bg-background px-2 text-ui text-foreground [--control-size:var(--button-sm)]"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )
        ) : null}
        <div className="min-w-32 flex-1">
          <TextField value={tags} ariaLabel="Tags" placeholder="Tags, comma separated" onChange={setTags} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!ready || busy}>
          {item === undefined ? 'Add' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
