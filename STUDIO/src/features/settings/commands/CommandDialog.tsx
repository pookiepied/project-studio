import { useEffect, useState } from 'react'
import { Button, Dialog, TextArea, TextField } from '@/components/primitives'
import type { CommandSource, HarnessFailure } from '@/platform/harness'

/**
 * Writing one of the person's own commands.
 *
 * Four fields, which are the whole of the file: the name typed after the
 * slash, the line the picker shows, the hint for what follows the name,
 * and the prompt. The prompt may name `$ARGUMENTS` for everything typed
 * after the command and `$1` to `$9` for its words; a prompt that names
 * neither gets the words appended, so nothing typed is lost. The dialog
 * says so once under the field, because it is the one rule a person writing
 * a command needs and would otherwise have to discover.
 */
export function CommandDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean
  /** The command being edited, or null for a new one. */
  editing: { readonly id: string; readonly source: CommandSource } | null
  onClose: () => void
  onSave: (
    id: string,
    source: { description: string; argumentHint: string; body: string },
  ) => Promise<HarnessFailure | null>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [argumentHint, setArgumentHint] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)

  // Seeded when the dialog opens on a command, cleared when it opens on none.
  useEffect(() => {
    if (!open) return
    setName(editing?.id ?? '')
    setDescription(editing?.source.description ?? '')
    setArgumentHint(editing?.source.argumentHint ?? '')
    setBody(editing?.source.body ?? '')
    setFailure(null)
    setBusy(false)
  }, [open, editing])

  const id = name.trim().toLowerCase()
  const validName = /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
  const valid = validName && body.trim().length > 0

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)
    const error = await onSave(id, {
      description: description.trim(),
      argumentHint: argumentHint.trim(),
      body: body.trim(),
    })
    if (error === null) {
      onClose()
      return
    }
    setBusy(false)
    setFailure(error)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing === null ? 'New command' : `Edit /${editing.id}`}
      width="30rem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} busy={busy} onClick={() => void submit()}>
            {editing === null ? 'Add command' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {editing === null ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">Name</span>
            <div className="flex items-center gap-1">
              <span className="text-ui text-muted-foreground">/</span>
              <TextField value={name} onChange={setName} placeholder="tidy" autoFocus />
            </div>
            {name !== '' && !validName ? (
              <span className="text-caption text-muted-foreground/80">
                Lowercase letters, digits and hyphens.
              </span>
            ) : null}
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Description</span>
          <TextField
            value={description}
            onChange={setDescription}
            placeholder="What the command does, in one line"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Argument hint</span>
          <TextField value={argumentHint} onChange={setArgumentHint} placeholder="[file]" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Prompt</span>
          <TextArea
            value={body}
            onChange={setBody}
            rows={8}
            placeholder="Tidy $ARGUMENTS without changing what it does."
            className="font-mono text-caption"
          />
          <span className="text-caption text-muted-foreground/80">
            $ARGUMENTS is everything typed after the name; $1 to $9 are its words. A prompt that
            names neither gets the words added at the end.
          </span>
        </label>

        {failure ? (
          <p role="alert" className="text-caption text-danger">
            {failure.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
