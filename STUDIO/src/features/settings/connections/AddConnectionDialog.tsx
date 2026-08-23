import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, Dialog, MenuItem, Popover, TextField } from '@/components/primitives'
import type { HarnessFailure, LanguageProtocol, ProviderConnectionDraft } from '@/platform/harness'
import { LANGUAGE_PROTOCOL_CHOICES, connectionIdFrom } from './draft'

/**
 * Adding a connection.
 *
 * ---- The API key, which is the whole reason this file is careful -----------
 *
 * This component is the only place in Studio that ever holds an API key, and
 * it holds it in a `useState` that dies with the component. Read that as the
 * specification, not as an implementation detail:
 *
 *   - it is never lifted into `useConnections`, a context, or a store;
 *   - it is never written to the Tauri store, localStorage or sessionStorage
 *     (the Tauri store is plaintext JSON in the app config directory, and it
 *     is the one persistent writable surface the webview has);
 *   - it is never put in a URL or a log line;
 *   - it is never read back, because there is no endpoint that returns one.
 *     The harness answers with a `CredentialStatus` and nothing more.
 *
 * It goes into the body of one POST. The harness strips it into the OS
 * credential store before the connection record exists, so the 201 that comes
 * back is already a record that cannot carry it.
 *
 * `close()` clears every field, including the key, before telling the parent.
 * The parent unmounts nothing -- the dialog stays mounted and hidden -- so the
 * clear is what actually forgets, and it must stay in front of `onClose`.
 *
 * There is no "show key" toggle. The argument for one is that people mistype
 * long secrets; the argument against is that this field is filled once, from a
 * clipboard, in a window that may be screen-shared, and the recovery from a
 * typo is cheap and immediate -- the probe says the key was refused. An eye
 * icon would trade a permanent exposure risk for a one-off convenience.
 *
 * ---- Why the base URL is required -----------------------------------------
 *
 * The harness treats `baseUrl` as optional because a connection can inherit
 * its address from `catalogProvider` -- the vendor whose built-in model list
 * applies. This dialog does not send a `catalogProvider`: the set of vendor
 * names the harness's built-in catalog knows is not exposed over HTTP, so
 * there is nothing to populate a vendor picker from, and guessing one would
 * silently give a connection somebody else's model list. With no vendor there
 * is no inherited address, so the URL is the only thing that can say where to
 * connect, and asking for it is honest rather than arbitrary.
 *
 * The visible consequence: a connection created here starts with no models
 * until they are entered by hand. That is the harness's own rule for an
 * endpoint the catalog has never heard of, and the copy at the bottom says so.
 */
export function AddConnectionDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  /** Resolves to the failure to show, or null when the connection was made. */
  onCreate: (draft: ProviderConnectionDraft) => Promise<HarnessFailure | null>
}) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState<LanguageProtocol>('openai-completions')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)

  const selected = LANGUAGE_PROTOCOL_CHOICES.find((item) => item.id === protocol)
  const id = connectionIdFrom(name)
  const valid = id.length > 0 && baseUrl.trim().length > 0

  const close = () => {
    setName('')
    setBaseUrl('')
    // The key is cleared here and nowhere else. Every other field is cleared
    // for tidiness; this one is cleared because leaving it would be the bug.
    setApiKey('')
    setProtocol('openai-completions')
    setFailure(null)
    setBusy(false)
    onClose()
  }

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)

    const trimmedKey = apiKey.trim()
    const error = await onCreate({
      id,
      displayName: name.trim(),
      kind: 'language',
      // `local` is the harness's own store on this machine. The only other
      // source is `test`, the in-memory double, which no user ever creates.
      source: 'local',
      enabled: true,
      baseUrl: baseUrl.trim(),
      protocol,
      // Omitted entirely rather than sent empty: the harness distinguishes an
      // absent key from a present one, and "" is a key it would try to store.
      ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
    })

    if (error === null) {
      close()
      return
    }

    // The dialog stays open with every field as it was. A harness that says
    // "that id already exists" has not invalidated the base URL somebody just
    // typed, and clearing the form to deliver an error message is a way of
    // making the second attempt cost as much as the first.
    setBusy(false)
    setFailure(error)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add connection"
      width="26rem"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} busy={busy} onClick={() => void submit()}>
            Add connection
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Display name</span>
          <TextField value={name} onChange={setName} placeholder="My gateway" autoFocus />
          {/* Shown rather than hidden: this is the name the harness files it
              under, the name a duplicate error will quote back, and the name
              its keychain entry takes. */}
          {id.length > 0 ? (
            <span className="text-caption text-muted-foreground/80">Filed as {id}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Base URL</span>
          <TextField
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://api.example.com/v1"
          />
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
            {LANGUAGE_PROTOCOL_CHOICES.map((item) => (
              <MenuItem
                key={item.id}
                selected={item.id === protocol}
                onSelect={() => {
                  setProtocol(item.id)
                  setMenuOpen(false)
                }}
              >
                {item.name}
              </MenuItem>
            ))}
          </Popover>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">API key (optional)</span>
          <TextField
            value={apiKey}
            onChange={setApiKey}
            type="password"
            autoComplete="off"
            ariaLabel="API key"
            placeholder="Leave empty for an endpoint that needs none"
          />
        </label>

        {failure ? (
          <p role="alert" className="text-caption text-danger">
            {failure.message}
          </p>
        ) : null}

        <p className="text-caption text-muted-foreground">
          The key is sent once and stored in this machine's credential store by the harness. Studio
          never keeps it and cannot read it back. Models for a new endpoint are added by hand.
        </p>
      </div>
    </Dialog>
  )
}
