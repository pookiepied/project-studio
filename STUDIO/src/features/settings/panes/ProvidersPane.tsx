import { useState } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import { Button, Dialog, MenuItem, Popover, TextField } from '@/components/primitives'
import { MODELS, PROVIDERS } from '@/domain/models/catalog'
import { COMPATIBILITIES, type Compatibility } from '@/domain/models/types'
import { Pane } from '@/features/settings/panes/Pane'

/**
 * Providers and models.
 *
 * The built-ins are listed with their model counts; adding one asks for the
 * three things a request cannot be made without -- a name, a base URL, and
 * which wire format the endpoint speaks.
 *
 * Compatibility is a closed list because it is not a description, it is a
 * branch in the client. Offering a free-text field would let someone type
 * something that fails at the first request with an error about JSON shape.
 *
 * The API key is deliberately not asked for here. Keys belong in the OS
 * credential store, which is the harness's job, and a text input in a settings
 * pane is exactly the wrong place to start that habit.
 */
export function ProvidersPane() {
  const [adding, setAdding] = useState(false)

  return (
    <Pane title="Providers" description="Where models come from.">
      {PROVIDERS.map((provider) => {
        const count = MODELS.filter((model) => model.providerId === provider.id).length
        return (
          <div key={provider.id} className="flex items-center gap-2.5 py-3">
            <span className="flex size-7 items-center justify-center rounded-md bg-selected text-foreground">
              <ProviderMark provider={provider.id} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ui text-foreground">{provider.name}</p>
              <p className="text-caption text-muted-foreground">
                {count} {count === 1 ? 'model' : 'models'}
              </p>
            </div>
          </div>
        )
      })}

      <div className="py-3">
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Icons.add />
          Add provider
        </Button>
      </div>

      <AddProviderDialog open={adding} onClose={() => setAdding(false)} />
    </Pane>
  )
}

function AddProviderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [compatibility, setCompatibility] = useState<Compatibility>('openai-chat')
  const [menuOpen, setMenuOpen] = useState(false)

  const selected = COMPATIBILITIES.find((item) => item.id === compatibility)
  const valid = name.trim().length > 0 && baseUrl.trim().length > 0

  const close = () => {
    setName('')
    setBaseUrl('')
    setCompatibility('openai-chat')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add provider"
      width="26rem"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={close}>
            Add provider
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Display name</span>
          <TextField value={name} onChange={setName} placeholder="My gateway" autoFocus />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Base URL</span>
          <TextField value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Speaks</span>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            side="bottom"
            align="start"
            className="min-w-60"
            trigger={
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-8 w-full items-center justify-between rounded-md border bg-surface px-2.5 text-ui text-foreground transition-colors duration-fast hover:bg-tint"
              >
                {selected?.name}
                <Icons.expand className="text-muted-foreground" />
              </button>
            }
          >
            {COMPATIBILITIES.map((item) => (
              <MenuItem
                key={item.id}
                selected={item.id === compatibility}
                onSelect={() => {
                  setCompatibility(item.id)
                  setMenuOpen(false)
                }}
              >
                {item.name}
              </MenuItem>
            ))}
          </Popover>
        </div>

        <p className="text-caption text-muted-foreground">
          The API key is asked for once on first use and stored in this machine's credential store,
          never in Studio's database.
        </p>
      </div>
    </Dialog>
  )
}
