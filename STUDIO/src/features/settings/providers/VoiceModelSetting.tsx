import { useEffect, useRef, useState } from 'react'
import { Button, MenuItem, Popover, TextField } from '@/components/primitives'
import type { ProviderConnection, ProviderModel } from '@/platform/harness'
import { voiceModelSetting } from '@/features/voice/settings'

export function VoiceModelSetting({ models, connections }: {
  models: readonly ProviderModel[]
  connections: readonly ProviderConnection[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(true)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void voiceModelSetting().then((result) => {
      if (!mounted.current) return
      setSaving(false)
      if (result.ok) setSelected(result.value.modelId)
      else setNote(result.error.message)
    }).catch(() => { if (mounted.current) { setSaving(false); setNote('Voice settings could not be loaded.') } })
    return () => { mounted.current = false }
  }, [])
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
      const result = await voiceModelSetting({ modelId })
      if (!mounted.current) return
      if (result.ok) { setSelected(result.value.modelId); setNote(''); setOpen(false); setSearch('') }
      else setNote(result.error.message)
    } catch { if (mounted.current) setNote('Voice settings could not be saved.') }
    finally { if (mounted.current) setSaving(false) }
  }
  return <div className="flex items-start justify-between gap-4 py-3.5">
    <div><p className="text-ui">Voice conversation</p>
      <p className="text-caption text-muted-foreground">{choices.find((choice) => choice.id === selected)?.name ?? selected ?? 'Choose a fast conversational model.'}</p>
      <p className="text-caption text-muted-foreground">Work uses the model selected in each chat. Speech and transcription use Media settings.</p>
      <p className="text-caption text-muted-foreground">Choose a model with tool calling to delegate work.</p>
      {note ? <p role="status" className="text-caption text-danger">{note}</p> : null}
    </div>
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" className="min-w-64" trigger={<Button variant="secondary" size="sm" aria-label="Choose voice conversation model" disabled={saving} onClick={() => setOpen((value) => !value)}>{selected === null ? 'Choose' : 'Change'}</Button>}>
      <div className="p-1.5"><TextField value={search} onChange={setSearch} placeholder="Search models" /></div>
      <div className="max-h-64 overflow-y-auto">{visible.map((choice) => <MenuItem key={choice.id} selected={selected === choice.id} onSelect={() => void choose(choice.id)}>{choice.name}</MenuItem>)}
      {visible.length === 0 ? <p className="px-2 py-2 text-caption text-muted-foreground">No model by that name.</p> : null}
      <MenuItem onSelect={() => void choose(null)}>Clear selection</MenuItem></div>
    </Popover>
  </div>
}
