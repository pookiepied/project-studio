import { useEffect, useRef, useState } from 'react'
import { Button, MenuItem, Popover, TextField } from '@/components/primitives'
import type { ProviderConnection, ProviderModel } from '@/platform/harness'
import { voiceModelSetting, type VoiceModelRole } from '@/features/voice/settings'

/** What each role's row says. Tasks' empty choice is a real one - the chat's own model - not a gap to fill. */
const COPY: Readonly<Record<VoiceModelRole, {
  readonly title: string
  readonly unset: string
  readonly notes: readonly string[]
  readonly label: string
  readonly clear: string
}>> = {
  conversation: {
    title: 'Voice conversation',
    unset: 'Choose a fast conversational model.',
    notes: ['Speech and transcription use Media settings.', 'Choose a model with tool calling to delegate work.'],
    label: 'Choose voice conversation model',
    clear: 'Clear selection',
  },
  tasks: {
    title: 'Voice tasks',
    unset: 'Same as the chat (default)',
    notes: ['The work a voice call hands off runs on this model. It has to call tools and read screenshots.'],
    label: 'Choose voice task model',
    clear: 'Same as the chat',
  },
}

export function VoiceModelSetting({ models, connections, role = 'conversation' }: {
  models: readonly ProviderModel[]
  connections: readonly ProviderConnection[]
  role?: VoiceModelRole
}) {
  const copy = COPY[role]
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(true)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void voiceModelSetting(undefined, role).then((result) => {
      if (!mounted.current) return
      setSaving(false)
      if (result.ok) setSelected(result.value.modelId)
      else setNote(result.error.message)
    }).catch(() => { if (mounted.current) { setSaving(false); setNote('Voice settings could not be loaded.') } })
    return () => { mounted.current = false }
  }, [role])
  const candidates = models.filter((model) => model.available && !model.hidden && model.capability.textGeneration === 'supported')
    .flatMap((model) => {
      const connection = connections.find((entry) => entry.id === model.connectionId)
      return connection?.serves.language === undefined ? [] : [{ id: `${connection.catalogProvider ?? connection.id}/${model.modelId}`, name: model.displayName }]
    })
  const choices = [...new Map(candidates.map((choice) => [choice.id, choice])).values()]
  const needle = search.trim().toLowerCase()
  const visible = needle === '' ? choices : choices.filter((choice) => choice.name.toLowerCase().includes(needle) || choice.id.toLowerCase().includes(needle))
  async function choose(modelId: string | null) {
    setSaving(true)
    try {
      const result = await voiceModelSetting({ modelId }, role)
      if (!mounted.current) return
      if (result.ok) { setSelected(result.value.modelId); setNote(''); setOpen(false); setSearch('') }
      else setNote(result.error.message)
    } catch { if (mounted.current) setNote('Voice settings could not be saved.') }
    finally { if (mounted.current) setSaving(false) }
  }
  return <div className="flex items-start justify-between gap-4 py-3.5">
    <div><p className="text-ui">{copy.title}</p>
      <p className="text-caption text-muted-foreground">{choices.find((choice) => choice.id === selected)?.name ?? selected ?? copy.unset}</p>
      {copy.notes.map((line) => <p key={line} className="text-caption text-muted-foreground">{line}</p>)}
      {note ? <p role="status" className="text-caption text-danger">{note}</p> : null}
    </div>
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" className="min-w-64" trigger={<Button variant="secondary" size="sm" aria-label={copy.label} disabled={saving} onClick={() => setOpen((value) => !value)}>{selected === null ? 'Choose' : 'Change'}</Button>}>
      <div className="p-1.5"><TextField value={search} onChange={setSearch} placeholder="Search models" /></div>
      <div className="max-h-64 overflow-y-auto">{visible.map((choice) => <MenuItem key={choice.id} selected={selected === choice.id} onSelect={() => void choose(choice.id)}>{choice.name}</MenuItem>)}
      {visible.length === 0 ? <p className="px-2 py-2 text-caption text-muted-foreground">No model by that name.</p> : null}
      <MenuItem onSelect={() => void choose(null)}>{copy.clear}</MenuItem></div>
    </Popover>
  </div>
}
