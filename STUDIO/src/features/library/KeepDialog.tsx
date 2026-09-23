import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, Dialog, TextArea, TextField } from '@/components/primitives'
import {
  useHarnessClient,
  type HarnessFailure,
  type LibraryDescription,
  type LibraryFacts,
  type LibraryItem,
} from '@/platform/harness'
import type { KeepCandidate } from '@/features/library/client'

/**
 * Keeping a file in the library, or editing what was said about one.
 *
 * ---- The two questions -----------------------------------------------------
 *
 * The dialog asks two things a search will later need answered. "Who or
 * what is this?" is the subject, and only the person can answer it: "me",
 * "Bruno", "the company logo". Nothing here guesses it, and the model is
 * never asked. "What does it show?" is the title, description and tags,
 * and for a picture the model is asked as soon as the dialog opens, so the
 * fields fill in while the person types the subject; they can change every
 * word. For anything but a picture the fields start empty.
 *
 * ---- Where the picture goes ------------------------------------------------
 *
 * The proposal is made by the person's default model - the one their
 * messages already go to - so keeping a picture sends it nowhere new. The
 * dialog says so in one line under the fields, once.
 *
 * ---- Nothing is kept without a yes ----------------------------------------
 *
 * Cancel keeps nothing. The composer's picture still rides on the message
 * either way; the library holds its own copy only after Keep.
 */
export function KeepDialog({
  open,
  candidate,
  editing,
  onClose,
  onKept,
}: {
  open: boolean
  /** The bytes to keep, for a new item. */
  candidate: KeepCandidate | null
  /** The item to edit, when there is one already. */
  editing: LibraryItem | null
  onClose: () => void
  /** The item as the harness recorded it. */
  onKept?: (item: LibraryItem) => void
}) {
  const connect = useHarnessClient()
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [tags, setTags] = useState('')
  const [description, setDescription] = useState('')
  const [proposing, setProposing] = useState(false)
  const [proposal, setProposal] = useState<'pending' | 'made' | 'failed' | 'none'>('none')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)

  const isImage = (candidate?.mimeType ?? editing?.mimeType ?? '').startsWith('image/')

  // The proposal fills only what is still empty: a word the person has
  // typed while the model was thinking is theirs.
  const apply = (made: LibraryDescription) => {
    setTitle((current) => (current.trim() === '' ? made.title : current))
    setDescription((current) => (current.trim() === '' ? made.description : current))
    setTags((current) => (current.trim() === '' ? made.tags.join(', ') : current))
  }

  // Seeded when the dialog opens: from the item when editing, empty for a
  // new file - and for a new picture, the model's proposal is asked for
  // straight away, filling the fields the person has not touched.
  useEffect(() => {
    if (!open) return
    setTitle(editing?.title ?? '')
    setSubject(editing?.subject ?? '')
    setTags(editing?.tags.join(', ') ?? '')
    setDescription(editing?.description ?? '')
    setFailure(null)
    setBusy(false)
    setProposal('none')
    if (editing !== null || candidate === null || !candidate.mimeType.startsWith('image/')) return

    let cancelled = false
    setProposing(true)
    setProposal('pending')
    void (async () => {
      const harness = await connect()
      const result =
        harness === null
          ? null
          : await harness.describeImage({
              data: candidate.data,
              mimeType: candidate.mimeType,
              hint: candidate.fileName,
            })
      if (cancelled) return
      setProposing(false)
      if (result === null || !result.ok) {
        setProposal('failed')
        return
      }
      apply(result.value)
      setProposal('made')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded on open only.
  }, [open, candidate, editing])

  const facts = (): LibraryFacts => ({
    title: title.trim(),
    description: description.trim(),
    subject: subject.trim(),
    tags: tags
      .split(/[,\n]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  })

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const harness = await connect()
    if (harness === null) {
      setBusy(false)
      setFailure({ kind: 'not-reachable', message: 'The harness is not running.', timedOut: false })
      return
    }
    const result =
      editing !== null
        ? await harness.updateLibraryItem(editing.id, facts())
        : candidate !== null
          ? await harness.addLibraryItem({
              ...facts(),
              fileName: candidate.fileName,
              mimeType: candidate.mimeType,
              data: candidate.data,
              sourceConversationId: candidate.sourceConversationId,
            })
          : null
    if (result === null) {
      setBusy(false)
      return
    }
    if (!result.ok) {
      setBusy(false)
      setFailure(result.error)
      return
    }
    onKept?.(result.value)
    onClose()
  }

  const fileName = candidate?.fileName ?? editing?.fileName ?? ''
  const preview = candidate !== null && isImage ? `data:${candidate.mimeType};base64,${candidate.data}` : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing === null ? 'Keep in the library' : 'Edit library item'}
      width="32rem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {editing === null ? 'Keep' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex items-center gap-3">
          {preview !== null ? (
            <img
              src={preview}
              alt=""
              className="size-16 shrink-0 rounded-md object-cover ring-1 ring-border"
              draggable={false}
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-tint text-muted-foreground">
              {isImage ? <Icons.image /> : <Icons.file />}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-ui text-foreground" title={fileName}>
              {fileName}
            </p>
            <p className="text-caption text-muted-foreground">
              {editing === null
                ? 'Kept for every conversation, not only this one.'
                : 'What you say here is what a conversation finds it by.'}
            </p>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Who or what is this?</span>
          <TextField
            value={subject}
            onChange={setSubject}
            ariaLabel="Who or what is this?"
            placeholder='"me", "Bruno", "company logo"'
            autoFocus
          />
          <span className="text-caption text-muted-foreground/80">
            Your own label. Later you can say "take my photo" and the model finds what you marked as you.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Title</span>
          <TextField
            value={title}
            onChange={setTitle}
            placeholder={proposing ? 'Asking the model…' : 'A few words'}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Tags</span>
          <TextField
            value={tags}
            onChange={setTags}
            ariaLabel="Tags"
            placeholder={proposing ? 'Asking the model…' : 'photo, hiking, mountains'}
          />
          <span className="text-caption text-muted-foreground/80">Separate with commas.</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Description</span>
          <TextArea
            value={description}
            onChange={setDescription}
            rows={3}
            placeholder={proposing ? 'Asking the model…' : 'What it shows, in a sentence or two'}
          />
        </label>

        {editing === null && isImage ? (
          <p className="text-caption text-muted-foreground/80">
            {proposal === 'failed'
              ? 'The model could not describe this picture; fill in the words yourself.'
              : 'The title, tags and description are proposed by your default model - the same one your messages go to. The subject is never asked of it.'}
          </p>
        ) : null}

        {failure ? (
          <p role="alert" className="text-caption text-danger">
            {failure.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
