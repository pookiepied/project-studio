import type { ToolCallView } from '@/features/chat/transcript/projection'

import { parseFileToolOutcome } from './editOutcome'
import { diffLines, type LineDiff } from './diffLines'

/**
 * The net of a same-file run: the diff between the file the run started with
 * and the file it ended with.
 *
 * ---- Why this is not the sum of the children ------------------------------
 *
 * Each call's own diff counts its own change: a line edited twice counts
 * once per edit, and a whole-file write counts every line it carries. The
 * run's header answers a different question -- "what did this run do to the
 * file?" -- and the honest answer is a diff of two states of the file, which
 * is smaller than the churn whenever the run reworked its own work.
 *
 * ---- Where the two states come from ---------------------------------------
 *
 * Nothing on the wire carries file snapshots, so the states are reconstructed
 * from the calls' own facts, and the reconstruction is trusted only while it
 * stays provable. An edit's opening state is its own anchor -- a region of
 * the file, real because the call was allowed to change it -- and every later
 * anchor must land, character for character, in the text the run has produced
 * so far. One assumption is load-bearing and stated here rather than hidden:
 * an anchor that occurs more than once in that text is read at its FIRST
 * occurrence, because the wire carries no position -- and on the one shape
 * where that guess could divide (duplicate lines re-edited at a later
 * occurrence) the honest number is unknowable, which is why the whole
 * reconstruction stays a statistic beside a churn fallback rather than a
 * ledger. A write proves the state it LEAVES; the state it found is provable
 * exactly once, when the harness's own sentence says the file was created
 * under this run's feet -- then the file began empty. Every other write
 * replaced a state the wire never carried, so the run has no provable
 * opening: the answer is null, and the header falls back to the children's
 * summed churn. A null says what is known; a summed count wearing the net's
 * name would be a lie with arithmetic's clothes on -- and a write diffed
 * against itself would be a worse one, the zero that says a created file
 * changed nothing.
 */
export function netOf(calls: readonly ToolCallView[]): LineDiff | null {
  let base: string | null = null
  let current: string | null = null
  // A whole-file write has landed whose pre-state the wire does not carry.
  // An edit after it cannot claim the opening state: the file it anchors in
  // began at that write, not at the run.
  let replaced = false

  for (const call of calls) {
    // A failed call changed nothing, so it contributes nothing here either.
    if (call.errorText !== null) continue
    const input = call.input !== null && call.input.present ? call.input.value : null
    const fields = isRecord(input) ? input : {}
    if (call.toolName === 'write') {
      const content = firstString(fields, ['content', 'contents'])
      if (content === null) return null
      if (base === null) {
        base = createdOf(call) ? '' : null
      } else if (base !== '') {
        // The run opened on an edit's region; the write replaced the whole
        // file, and that region's story ends here.
        return null
      }
      replaced = true
      current = content
      continue
    }
    if (call.toolName !== 'edit') return null
    // `replaceAll` changes every occurrence in the file, and the run's
    // reconstruction can only see the span it has rebuilt so far. Occurrences
    // outside that span are real changes this walk cannot count, so the net
    // would come out short while wearing the net's name. Unprovable, and so
    // null, like every other shape this module refuses to guess at.
    if (fields.replaceAll === true) return null
    // The harness's own field names are the camelCase pair; the snake_case
    // spellings stand for other harnesses whose edit is shaped the same way.
    const oldText = firstString(fields, ['oldString', 'old_string', 'old_str', 'original'])
    const newText = firstString(fields, ['newString', 'new_string', 'new_str', 'replacement'])
    // An empty `newString` is a deletion, which is an edit like any other.
    // An empty `oldString` is not an edit at all -- the harness refuses it,
    // and `indexOf("")` would answer 0 and splice text in at the top.
    if (oldText === null || oldText === '' || newText === null) return null
    if (base === null) {
      if (replaced) return null
      // The run's opening state is the first edit's own anchor: a region of
      // the file, not the whole file. Every later anchor must land inside
      // what the run has produced since, or there is no net.
      base = oldText
      current = newText
      continue
    }
    if (current === null) return null
    const at = current.indexOf(oldText)
    if (at === -1) return null
    current = current.slice(0, at) + newText + current.slice(at + oldText.length)
  }

  return base !== null && current !== null ? diffLines(base, current) : null
}

/** Whether the harness's own sentence says this write created the file. */
function createdOf(call: ToolCallView): boolean {
  const output = call.output
  if (output === null || !output.present || typeof output.value !== 'string') return false
  const outcome = parseFileToolOutcome(output.value)
  return outcome?.status.startsWith('Created') ?? false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Emptiness is a fact here, not an absence -- the same rule the chips' own
 * reader follows, and for the same reason. A write of an empty file and an
 * edit that deletes carry `""`, and treating that as a missing field dropped
 * the net for both, silently, in favour of the churn fallback. Only a missing
 * or non-string field counts as nothing; where a particular field may not be
 * empty, the caller says so where the rule lives.
 */
function firstString(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string') return value
  }
  return null
}
