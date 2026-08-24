import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

import type { ToolCallView, ToolGroupView } from '@/features/chat/transcript/projection'

/**
 * Structurally grouped tool calls, in the three levels the architecture doc
 * names: a collapsed count per tool kind, the individual calls, and one
 * call's input and output.
 *
 * Every label here is a fact -- the verb is the tool's own name, humanized;
 * the number is how many calls that kind made within one assistant message.
 * No semantic summary exists at any level and none may be added: a group
 * collapsed on screen is still fully present in what was sent, and this
 * display must never claim to summarise it beyond counting.
 */
export function ToolGroups({ groups }: { groups: readonly ToolGroupView[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-1',
          'text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground',
        )}
      >
        <span>{summaryLine(groups)}</span>
        <Icons.disclosure state={open ? 'on' : 'rest'} />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...COLLAPSE} className="overflow-hidden">
            <div className="mt-1 ml-1.5 flex flex-col gap-1 border-l-2 pl-3">
              {groups.map((group) => (
                <ToolCallRows key={group.toolName} group={group} />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** Level two: the calls of one kind. Each row expands again into detail. */
function ToolCallRows({ group }: { group: ToolGroupView }) {
  const [openCall, setOpenCall] = useState<string | null>(null)

  return (
    <div className="flex flex-col">
      {group.calls.map((call) => (
        <div key={call.toolCallId} className="flex flex-col">
          <button
            type="button"
            onClick={() =>
              setOpenCall((current) => (current === call.toolCallId ? null : call.toolCallId))
            }
            aria-expanded={openCall === call.toolCallId}
            className={cn(
              'group/call inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-1 text-left',
              'text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground',
            )}
          >
            <Icons.disclosure state={openCall === call.toolCallId ? 'on' : 'rest'} />
            <span className="truncate">{callLine(call)}</span>
            {call.errorText !== null ? (
              <span className="shrink-0 text-destructive">failed</span>
            ) : call.output === null || !call.output.present ? (
              <span className="shrink-0 opacity-60">running</span>
            ) : null}
          </button>

          <AnimatePresence initial={false}>
            {openCall === call.toolCallId ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="overflow-hidden"
              >
                {/* Level three: exactly what went in and what came out,
                    pretty-printed but otherwise untouched. */}
                <div className="mb-1 ml-4 flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  <Detail label="in" value={call.input} />
                  {call.errorText !== null ? (
                    <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-destructive">
                      {call.errorText}
                    </pre>
                  ) : call.output?.present ? (
                    <Detail label="out" value={call.output} />
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value: { readonly present: boolean; readonly value: unknown } | null
}) {
  if (value === null || !value.present) return null
  return (
    <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere]">
      {label}: {jsonOf(value.value)}
    </pre>
  )
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The verb for a tool name, where the harness's own tools are concerned.
 * Anything else renders under its raw name -- a name we have never heard of
 * gets shown, not guessed at.
 */
const TOOL_VERBS: Record<string, string> = {
  read: 'Read',
  write: 'Wrote',
  edit: 'Edited',
  bash: 'Ran',
  glob: 'Searched',
  grep: 'Searched',
  list: 'Listed',
}

function summaryLine(groups: readonly ToolGroupView[]): string {
  return groups
    .map((group) => `${TOOL_VERBS[group.toolName] ?? group.toolName} ${group.calls.length}`)
    .join(' · ')
}

function callLine(call: ToolCallView): string {
  const subject = subjectOf(call)
  return subject === null ? `${TOOL_VERBS[call.toolName] ?? call.toolName}` : subject
}

/**
 * The one fact worth showing per expanded call: which file, which command --
 * taken from the input the model actually sent, by field name, never inferred.
 */
function subjectOf(call: ToolCallView): string | null {
  if (call.input === null || !call.input.present) return null
  const input: unknown = call.input.value
  if (!isRecord(input)) return typeof input === 'string' && input.length > 0 ? input : null
  for (const key of ['path', 'file_path', 'command', 'pattern', 'query', 'url']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
