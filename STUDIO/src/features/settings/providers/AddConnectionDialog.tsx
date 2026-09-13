import { useMemo, useState } from 'react'
import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models/ProviderMark'
import { Button, Dialog, MenuItem, Popover, TextField } from '@/components/primitives'
import type {
  HarnessFailure,
  LanguageProtocol,
  LibraryProvider,
  ProbeResult,
  ProviderConnectionDraft,
} from '@/platform/harness'
import { SLOT_LABELS } from '@/domain/models/slots'
import { connectionIdFrom, LANGUAGE_PROTOCOL_CHOICES } from './draft'

/**
 * Adding a connection, from the provider library or by hand.
 *
 * ---- The library first -----------------------------------------------------
 *
 * A provider is a source, and the library is the list of sources the three
 * catalogs can name: Pi's language vendors, Pi's image vendors, and the
 * providers Studio declares itself for everything Pi has none of. Each entry
 * shows the capabilities it actually serves, so picking one answers "what will
 * this connect for" before any key is typed. Choosing an entry fills kind,
 * protocol and `catalogProvider` - the harness's own answers, never guesses -
 * and the base URL only needs typing when the user wants to override the
 * vendor's own.
 *
 * ---- Custom, first class ----------------------------------------------------
 *
 * The custom form is the other half: display name, base URL, protocol, and an
 * optional key. It sends no `catalogProvider`, which is the harness's spelling
 * of "an endpoint no catalog has heard of"; such a connection serves the
 * models the user enters by hand, and the copy at the bottom says so.
 *
 * ---- The API key ------------------------------------------------------------
 *
 * This component is one of the only places in Studio that ever holds an API
 * key, and it holds it in a `useState` that dies with the component:
 *
 *   - it is never lifted into the hook, a context, or a store;
 *   - it is never written to the Tauri store, localStorage or sessionStorage;
 *   - it is never put in a URL or a log line;
 *   - it is never read back, because there is no endpoint that returns one.
 *     The harness answers with a `CredentialStatus` and nothing more.
 *
 * It goes into the body of one POST. `close()` clears every field, including
 * the key, before telling the parent - and the clear must stay in front of
 * `onClose`, because the dialog stays mounted and hidden and the clear is what
 * actually forgets.
 *
 * ---- The probe --------------------------------------------------------------
 *
 * After the connection is created the dialog probes it and reports what the
 * probe actually learned: the model count it enumerated, or the provider's own
 * error sentence. From there, one button opens the model library - what is
 * selected there is what the rest of the product offers.
 */

type Mode = { readonly kind: 'pick' } | { readonly kind: 'library'; readonly entry: LibraryProvider } | { readonly kind: 'custom' }

export function AddConnectionDialog({
  open,
  onClose,
  onCreate,
  onProbe,
  library,
  customEndpoint = true,
}: {
  open: boolean
  onClose: () => void
  /** Resolves to the failure to show, or null when the connection was made. */
  onCreate: (draft: ProviderConnectionDraft) => Promise<HarnessFailure | null>
  /** Probes the new connection; resolves to null only when there was no harness to ask. */
  onProbe: (id: string) => Promise<ProbeResult | HarnessFailure | null>
  library: readonly LibraryProvider[]
  /**
   * Whether a self-hosted endpoint may be added here. Only the Models page
   * offers it: a custom endpoint speaks one of the language wires, and there
   * is no such thing as a custom media or search endpoint to name.
   */
  customEndpoint?: boolean
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'pick' })
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState<LanguageProtocol>('openai-completions')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)
  const [probeOutcome, setProbeOutcome] = useState<ProbeResult | HarnessFailure | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return library
    return library.filter(
      (entry) =>
        entry.displayName.toLowerCase().includes(needle) ||
        entry.id.includes(needle),
    )
  }, [library, search])

  const close = () => {
    setMode({ kind: 'pick' })
    setSearch('')
    setName('')
    setBaseUrl('')
    // The key is cleared here and nowhere else. Every other field is cleared
    // for tidiness; this one is cleared because leaving it would be the bug.
    setApiKey('')
    setProtocol('openai-completions')
    setFailure(null)
    setBusy(false)
    setProbeOutcome(null)
    setCreatedId(null)
    onClose()
  }

  const resetForm = () => {
    setName('')
    setBaseUrl('')
    setApiKey('')
    setProtocol('openai-completions')
    setFailure(null)
  }

  const submit = async (): Promise<string | null> => {
    if (busy) return null
    setBusy(true)
    setFailure(null)

    const trimmedKey = apiKey.trim()
    const trimmedBaseUrl = baseUrl.trim()
    let draft: ProviderConnectionDraft
    if (mode.kind === 'library') {
      const entry = mode.entry
      const id = connectionIdFrom(name.trim() || entry.displayName)
      if (id.length === 0) {
        setBusy(false)
        setFailure({ kind: 'harness-error', status: 0, message: 'The display name must contain letters or digits.' })
        return null
      }
      // One key, entered once: the connection serves every kind the library
      // says this vendor serves, so an OpenAI key added here reaches chat,
      // images and audio without a second connection.
      draft = {
        id,
        displayName: name.trim() || entry.displayName,
        source: 'local' as const,
        enabled: true,
        catalogProvider: entry.id,
        // An empty override is no override: absent means the vendor's own
        // address, and the schema refuses an empty string in any case.
        ...(trimmedBaseUrl === '' ? {} : { baseUrl: trimmedBaseUrl }),
        ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
        serves: entry.serves,
      }
    } else {
      const id = connectionIdFrom(name.trim())
      if (id.length === 0 || trimmedBaseUrl === '') {
        setBusy(false)
        setFailure({
          kind: 'harness-error',
          status: 0,
          message: 'A display name and a base URL are both needed for a custom endpoint.',
        })
        return null
      }
      draft = {
        id,
        displayName: name.trim(),
        source: 'local',
        enabled: true,
        baseUrl: trimmedBaseUrl,
        serves: { language: protocol },
        ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
      }
    }

    const error = await onCreate(draft)
    if (error !== null) {
      // The dialog stays open with every field as it was. A harness that says
      // "that id already exists" has not invalidated the base URL somebody
      // just typed, and clearing the form to deliver an error message is a
      // way of making the second attempt cost as much as the first.
      setBusy(false)
      setFailure(error)
      return null
    }

    setBusy(false)
    setApiKey('')
    return draft.id
  }

  const submitAndProbe = async () => {
    const id = await submit()
    if (id === null) return
    setCreatedId(id)
    setProbeOutcome(await onProbe(id))
  }

  const title =
    mode.kind === 'pick' ? 'Add connection' : mode.kind === 'custom' ? 'Custom endpoint' : mode.entry.displayName

  const formReady =
    mode.kind === 'custom'
      ? connectionIdFrom(name.trim()).length > 0 && baseUrl.trim().length > 0
      : mode.kind === 'library'
        ? connectionIdFrom(name.trim() || mode.entry.displayName).length > 0
        : false

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      width="28rem"
      footer={
        mode.kind === 'pick' ? (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        ) : createdId !== null ? (
          <Button variant="ghost" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode({ kind: 'pick' })}>
              Back
            </Button>
            <Button variant="primary" disabled={!formReady} busy={busy} onClick={() => void submitAndProbe()}>
              Add and check
            </Button>
          </>
        )
      }
    >
      {mode.kind === 'pick' ? (
        <div className="flex flex-col gap-3 pt-1">
          <TextField value={search} onChange={setSearch} placeholder="Search providers" autoFocus />
          <div className="max-h-80 overflow-y-auto">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setMode({ kind: 'library', entry })
                  resetForm()
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-tint"
              >
                <ProviderMark provider={entry.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-foreground">{entry.displayName}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {entry.capabilities.map((slot) => SLOT_LABELS[slot]).join(' - ')}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {entry.modelCount} {entry.modelCount === 1 ? 'model' : 'models'}
                </span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-caption text-muted-foreground">
                {customEndpoint
                  ? 'No provider by that name. A private endpoint can still be added by hand below.'
                  : 'No provider by that name.'}
              </p>
            ) : null}
          </div>
          {customEndpoint ? (
            <div className="border-t pt-3">
              <Button variant="secondary" icon={<Icons.add />} onClick={() => setMode({ kind: 'custom' })}>
                Custom endpoint
              </Button>
            </div>
          ) : null}
        </div>
      ) : mode.kind === 'custom' ? (
        <div className="flex flex-col gap-4 pt-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">Display name</span>
            <TextField value={name} onChange={setName} placeholder="My gateway" autoFocus />
            {connectionIdFrom(name.trim()).length > 0 ? (
              <span className="text-caption text-muted-foreground/80">
                Filed as {connectionIdFrom(name.trim())}
              </span>
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
                  {LANGUAGE_PROTOCOL_CHOICES.find((item) => item.id === protocol)?.name}
                  <Icons.expand />
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
      ) : (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex items-center gap-2.5">
            <ProviderMark provider={mode.entry.id} />
            <div className="min-w-0">
              <p className="text-ui text-foreground">{mode.entry.displayName}</p>
              <p className="text-caption text-muted-foreground">
                {mode.entry.capabilities.map((slot) => SLOT_LABELS[slot]).join(' - ')}
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">Display name</span>
            <TextField value={name} onChange={setName} placeholder={mode.entry.displayName} autoFocus />
            {connectionIdFrom(name.trim() || mode.entry.displayName).length > 0 ? (
              <span className="text-caption text-muted-foreground/80">
                Filed as {connectionIdFrom(name.trim() || mode.entry.displayName)}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">Base URL override (optional)</span>
            <TextField
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder={mode.entry.baseUrl ?? 'The vendor does not publish one'}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">API key (optional)</span>
            <TextField
              value={apiKey}
              onChange={setApiKey}
              type="password"
              autoComplete="off"
              ariaLabel="API key"
              placeholder="Leave empty if this endpoint needs none"
            />
          </label>

          {failure ? (
            <p role="alert" className="text-caption text-danger">
              {failure.message}
            </p>
          ) : null}

          <p className="text-caption text-muted-foreground">
            The key is sent once and stored in this machine's credential store by the harness. Studio
            never keeps it and cannot read it back.
          </p>
        </div>
      )}

      {createdId !== null ? (
        <div className="mt-4 flex flex-col gap-2 border-t pt-3">
          <ProbeOutcome outcome={probeOutcome} />
        </div>
      ) : null}
    </Dialog>
  )
}

/**
 * What the probe actually learned, stated in one line.
 *
 * The model count when it could enumerate, the provider's own sentence when it
 * could not, and the transport failure when Studio never got an answer to
 * grade. Nothing here is softened into a generic "connected".
 */
function ProbeOutcome({ outcome }: { outcome: ProbeResult | HarnessFailure | null }) {
  if (outcome === null) {
    return <p className="text-caption text-muted-foreground">Not checked - no harness to ask.</p>
  }
  if ('ok' in outcome) {
    const result: ProbeResult = outcome
    if (!result.ok) {
      return <p className="text-caption text-danger">{result.failure ?? 'The endpoint did not answer acceptably.'}</p>
    }
    return (
      <p className="text-caption text-muted-foreground">
        {result.modelCount === undefined
          ? 'Reachable.'
          : `${result.modelCount} ${result.modelCount === 1 ? 'model' : 'models'} listed by the provider.`}
      </p>
    )
  }
  return <p className="text-caption text-danger">{outcome.message}</p>
}
