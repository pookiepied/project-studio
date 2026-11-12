import { useEffect, useState } from 'react'
import { Button, Dialog, TextField } from '@/components/primitives'
import type { HarnessClient } from '@/platform/harness'
import { openExternalUrl } from '@/platform/tauri/external'
import { connectToHarness } from './useProviders'

export function WalkingRouteSetting() {
  const [client, setClient] = useState<HarnessClient | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    void (async () => {
      const connection = await connectToHarness()
      if (connection === null || disposed) return
      const result = await connection.getRoutingStatus()
      if (disposed) return
      if (result.ok) {
        setClient(connection)
        setConfigured(result.value.configured)
      } else {
        setError(result.error.message)
      }
    })()
    return () => { disposed = true }
  }, [])

  function close() {
    if (busy) return
    setKey('')
    setError('')
    setOpen(false)
  }

  async function update(remove: boolean) {
    if (client === null || busy) return
    setBusy(true)
    setError('')
    const result = remove ? await client.removeRoutingKey() : await client.setRoutingKey(key)
    setBusy(false)
    if (result.ok) {
      setConfigured(!remove)
      setKey('')
      setOpen(false)
    } else setError(result.error.message)
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 py-3.5">
        <div>
          <p className="text-ui">Walking routes</p>
          <p className="text-caption text-muted-foreground">
            {configured === true ? 'openrouteservice key saved' : 'Connect openrouteservice for walking itineraries.'}
          </p>
          {!open && error ? <p role="alert" className="mt-1 text-caption text-danger">{error}</p> : null}
        </div>
        <Button size="sm" disabled={client === null} onClick={() => setOpen(true)}>
          {configured === true ? 'Manage key' : 'Connect'}
        </Button>
      </div>
      <Dialog open={open} onClose={close} title="Walking routes" footer={
        <>
          {configured === true ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void update(true)}>Remove key</Button> : null}
          <Button size="sm" variant="primary" busy={busy} disabled={key.trim() === ''} onClick={() => void update(false)}>Save key</Button>
        </>
      }>
        <p className="mb-3 text-caption text-muted-foreground">Paste your openrouteservice API key. Studio stores it in your device’s secure credential store.</p>
        <TextField type="password" ariaLabel="Openrouteservice API key" value={key} onChange={setKey} autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter' && key.trim() !== '') void update(false) }} />
        <div className="mt-2">
          <Button size="xs" variant="ghost" onClick={() => void openExternalUrl('https://account.heigit.org/').catch(() => setError('Could not open the HeiGIT account page.'))}>Get an API key</Button>
        </div>
        {error ? <p role="alert" className="mt-2 text-caption text-danger">{error}</p> : null}
      </Dialog>
    </>
  )
}
