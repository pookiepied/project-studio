import { useEffect, useState } from 'react'
import { Button, Dialog, Segmented, TextArea, TextField } from '@/components/primitives'
import { StateNote } from '@/components/state/StateNote'
import {
  EMPTY_FORM,
  formFrom,
  fromJson,
  problemWith,
  toDraft,
  toJson,
  type ServerForm,
} from '@/features/settings/mcp/draft'
import type { HarnessFailure, McpServerDraft, McpServerRecord } from '@/platform/harness'

/**
 * Add or edit an MCP server.
 *
 * One dialog for both, because they are the same object with a different
 * starting value, and two dialogs would be two places for the field list to
 * drift.
 *
 * ---- The secret ----------------------------------------------------------
 *
 * It is never part of the record. It travels in its own call to its own
 * route, is held in this component's state, and dies when the dialog
 * unmounts. Nothing writes it to the Tauri store, `localStorage`, a context,
 * a URL or a log line, and no read path can return it - the harness puts it
 * in the OS credential store and the record only ever carries the NAME of the
 * variable or header it belongs to.
 *
 * That is also what makes the JSON view safe: the object shown there is the
 * draft, and the draft has no secret field to print.
 */
export function ServerDialog({
  open,
  editing,
  onClose,
  onSave,
  onSaveCredential,
}: {
  open: boolean
  /** The server being changed, or `null` to add a new one. */
  editing: McpServerRecord | null
  onClose: () => void
  onSave: (draft: McpServerDraft) => Promise<HarnessFailure | null>
  onSaveCredential: (id: string, secret: string) => Promise<HarnessFailure | null>
}) {
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM)
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [json, setJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Reset on every open, so a dialog closed halfway through does not reappear
  // holding somebody's half-finished previous edit - and so the secret from a
  // previous server cannot survive into the next one.
  useEffect(() => {
    if (!open) return
    setForm(editing === null ? EMPTY_FORM : formFrom(editing))
    setMode('form')
    setSecret('')
    setJsonError(null)
    setFailure(null)
  }, [open, editing])

  const problem = problemWith(form)

  /**
   * Moving between views.
   *
   * Going to JSON renders the current form. Coming back parses it, and a
   * refusal keeps you in the JSON view with the reason: silently discarding
   * an unparseable edit is how someone loses work they can see on screen.
   */
  const switchTo = (next: 'form' | 'json') => {
    if (next === 'json') {
      setJson(toJson(form))
      setJsonError(null)
      setMode('json')
      return
    }
    const parsed = fromJson(json)
    if (!parsed.ok) {
      setJsonError(parsed.error)
      return
    }
    setForm(parsed.form)
    setJsonError(null)
    setMode('form')
  }

  const submit = async () => {
    // The JSON view is the live one while it is open, so a save from there
    // reads the text rather than the form behind it.
    let outgoing = form
    if (mode === 'json') {
      const parsed = fromJson(json)
      if (!parsed.ok) {
        setJsonError(parsed.error)
        return
      }
      outgoing = parsed.form
    }
    const stop = problemWith(outgoing)
    if (stop !== null) {
      setFailure(stop)
      return
    }

    setSaving(true)
    setFailure(null)
    const saved = await onSave(toDraft(outgoing))
    if (saved !== null) {
      setSaving(false)
      setFailure(saved.message)
      return
    }

    // The credential goes second and only if one was typed. The record has to
    // exist first: the harness refuses a credential for a server it does not
    // have installed, and it stores the secret against the server's id.
    if (secret !== '') {
      const stored = await onSaveCredential(outgoing.id.trim(), secret)
      if (stored !== null) {
        setSaving(false)
        setFailure(`The server was saved, but its secret was not: ${stored.message}`)
        return
      }
    }

    setSaving(false)
    setSecret('')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing === null ? 'Add MCP server' : `Edit ${editing.title}`}
      width="30rem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={saving || (mode === 'form' && problem !== null)}
          >
            {editing === null ? 'Add server' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {/* The view switch belongs at the top, not beside the save button.
            Form and JSON are two ways of looking at the same server, so the
            control that swaps them is a header for the content below it; sat
            in the footer it read as a third action of equal rank to Cancel
            and Save, which is a thing to decide rather than a way to look. */}
        <div className="flex justify-end">
          <Segmented
            layoutId="mcp-dialog-view"
            ariaLabel="How to edit this server"
            value={mode}
            onChange={switchTo}
            options={[
              { id: 'form', label: 'Form' },
              { id: 'json', label: 'JSON' },
            ]}
          />
        </div>

        {mode === 'json' ? (
          <JsonView value={json} onChange={setJson} error={jsonError} />
        ) : (
          <FormView
            form={form}
            editing={editing !== null}
            secret={secret}
            onSecret={setSecret}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          />
        )}

        {/* The first thing wrong with the form, shown quietly rather than as
            an error: nothing has failed yet, the person is still typing. A
            failure from the harness is different and replaces it. */}
        {failure !== null ? (
          <StateNote title="That could not be saved." detail={failure} />
        ) : mode === 'form' && problem !== null ? (
          <p className="text-caption text-muted-foreground">{problem}</p>
        ) : null}
      </div>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  // The hint sits OUTSIDE the label element. Inside, it becomes part of the
  // control's accessible name, so a screen reader announces the whole
  // explanation every time focus lands on the field - and "Id" stops being
  // findable by its own name.
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-ui text-foreground">{label}</span>
        {children}
      </label>
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function FormView({
  form,
  editing,
  secret,
  onSecret,
  onChange,
}: {
  form: ServerForm
  editing: boolean
  secret: string
  onSecret: (value: string) => void
  onChange: (patch: Partial<ServerForm>) => void
}) {
  const stdio = form.transport === 'stdio'

  return (
    <>
      <Field label="Name" hint="What you will see in the list.">
        <TextField
          value={form.title}
          onChange={(title) => onChange({ title })}
          placeholder="Filesystem"
          autoFocus
        />
      </Field>

      {/* Separate from the name, because they are read by different people.
          The name is what the person scans this list for; this sentence is
          what the model is told the server is for before it has seen a single
          tool definition, so it is the field that decides whether the server
          is reached for at all. Left blank the server is still listed, just
          without a sentence. */}
      <Field label="What it is for" hint="One sentence. The model reads this.">
        <TextField
          value={form.description}
          onChange={(description) => onChange({ description })}
          placeholder="Reads and writes files under a chosen folder."
        />
      </Field>

      <Field
        label="Id"
        hint={
          editing
            ? 'Changing an id installs a separate server rather than renaming this one.'
            : 'Used to namespace this server\u2019s tools. Letters, numbers, dots, dashes, underscores.'
        }
      >
        <TextField
          value={form.id}
          onChange={(id) => onChange({ id })}
          placeholder="filesystem"
        />
      </Field>

      {/* Two, and there will not be a third. The deprecated HTTP+SSE transport
          is not implemented and is deliberately not offered. There is also no
          protocol version here: the harness probes which revision a server
          speaks, so a picker would only give someone a way to be wrong about
          their own server. */}
      <Field label="Type">
        <Segmented
          layoutId="mcp-transport"
          ariaLabel="How the server is reached"
          value={form.transport}
          onChange={(transport) => onChange({ transport })}
          options={[
            { id: 'stdio', label: 'Local command' },
            { id: 'http', label: 'HTTP' },
          ]}
        />
      </Field>

      {stdio ? (
        <>
          <Field label="Command" hint="The path to a real executable. Not a .cmd or .bat shim.">
            <TextField
              value={form.command}
              onChange={(command) => onChange({ command })}
              placeholder="C:\\Program Files\\nodejs\\node.exe"
            />
          </Field>

          <Field label="Arguments" hint="One argument per line. Spaces in a path are fine.">
            <TextArea
              value={form.args}
              onChange={(args) => onChange({ args })}
              rows={3}
              placeholder={'--root\nC:\\Program Files\\example\\server.js'}
            />
          </Field>

          <Field label="Environment" hint="One NAME=value per line. Never a secret.">
            <TextArea
              value={form.env}
              onChange={(env) => onChange({ env })}
              rows={3}
              placeholder={'ROOT=D:\\projects\nLOG_LEVEL=info'}
            />
          </Field>

          <Field
            label="Network"
            hint={
              form.needsNetwork
                ? 'The server may reach the network when it is contained.'
                : 'The server is contained with no network at all.'
            }
          >
            <Segmented
              layoutId="mcp-network"
              ariaLabel="Network"
              value={form.needsNetwork ? 'on' : 'off'}
              onChange={(value) => onChange({ needsNetwork: value === 'on' })}
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
            />
          </Field>
        </>
      ) : (
        <Field label="Address" hint="One endpoint, Streamable HTTP.">
          <TextField
            value={form.url}
            onChange={(url) => onChange({ url })}
            placeholder="https://example.com/mcp"
          />
        </Field>
      )}

      <Field label="Authentication">
        <Segmented
          layoutId="mcp-auth"
          ariaLabel="Authentication"
          value={form.auth}
          onChange={(auth) => onChange({ auth })}
          options={[
            { id: 'none', label: 'None' },
            { id: 'bearer', label: 'Bearer' },
            { id: 'header', label: 'Header' },
          ]}
        />
      </Field>

      {form.auth === 'header' ? (
        <Field label="Header name" hint="The header the secret is sent in. Not the secret.">
          <TextField
            value={form.authHeader}
            onChange={(authHeader) => onChange({ authHeader })}
            placeholder="X-Api-Key"
          />
        </Field>
      ) : null}

      {form.auth !== 'none' && stdio ? (
        <Field
          label="Secret variable"
          hint="The environment variable the server reads its key from. The value is stored separately."
        >
          <TextField
            value={form.authEnvVar}
            onChange={(authEnvVar) => onChange({ authEnvVar })}
            placeholder="API_KEY"
          />
        </Field>
      ) : null}

      {form.auth !== 'none' ? (
        <Field
          label="Secret"
          hint={
            editing
              ? 'Leave blank to keep the stored one. It is never shown again once saved.'
              : 'Stored in your operating system\u2019s credential store, never in Studio.'
          }
        >
          <TextField
            value={secret}
            onChange={onSecret}
            type="password"
            autoComplete="off"
            placeholder={editing ? 'Unchanged' : ''}
          />
        </Field>
      ) : null}
    </>
  )
}

/**
 * The same server, as the object that is actually sent.
 *
 * For pasting a configuration from a README, which is how most MCP servers
 * are distributed, and for reading back exactly what will go over the wire.
 */
function JsonView({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextArea
        value={value}
        onChange={onChange}
        rows={16}
        className="font-mono text-code"
      />
      {error !== null ? <p className="text-caption text-danger">{error}</p> : null}
    </div>
  )
}
