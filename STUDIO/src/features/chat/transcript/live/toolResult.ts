import { isRecord } from '@/lib/guards'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { jobReports } from './tools/jobReports'

export type ResultState = 'success' | 'failed' | 'running' | 'pending' | 'background'

/** A process can fail without the tool transport itself throwing an error. */
export function resultState(call: ToolCallView, live = false): ResultState {
  if (call.errorText !== null) return 'failed'
  if (!call.output?.present) return live ? 'running' : 'pending'
  const output: unknown = call.output.value
  if (call.toolName === 'jobs' && typeof output === 'string' && jobReports(output).some((job) =>
    job.state.startsWith('failed') || /^exited (?!0$)-?\d+$/.test(job.state))) return 'failed'
  if (isRecord(output) && (output['isError'] === true ||
    (typeof output['exitCode'] === 'number' && output['exitCode'] !== 0))) return 'failed'
  if (call.toolName === 'discover' && typeof output === 'string' &&
    /^(?:No (?:extension|MCP server) .+ is installed|mcp:\S+ is installed, but switched off|mcp:\S+ has no tool named)/.test(output)) return 'failed'
  if (call.toolName === 'shell' || call.toolName === 'git') {
    if (typeof output === 'string') {
      if (call.toolName === 'git' && /^git \S+ exited with code -?\d+\.\n/.test(output)) return 'failed'
      const exit = output.match(/(?:^|\n)\[exit code (-?\d+)\](?:\n\n\[sandbox\][\s\S]*)?\s*$/)
      if (exit !== null && Number(exit[1]) !== 0) return 'failed'
      if (/^The command runs [\s\S]*so nothing ran\./.test(output)) return 'failed'
      if (/^Started \S+ in the background:/.test(output)) return 'background'
    }
  }
  return 'success'
}

/** Presentation only: wire names remain untouched when calls are dispatched. */
export function readableName(name: string): string {
  let display = name
  if (name.startsWith('mcp__')) {
    // Mirrors application/tool-name.ts's length-prefixed identities. Splitting
    // on '__' alone corrupts names whose server or tool contains that sequence.
    const encoded = name.slice(5)
    const head = /^(\d+)_/.exec(encoded)
    if (head !== null) {
      const start = head[0].length
      const server = encoded.slice(start, start + Number(head[1]))
      const rest = encoded.slice(start + server.length)
      const tail = /^__(\d+)_/.exec(rest)
      const tool = tail === null ? '' : rest.slice(tail[0].length)
      if (tail !== null && tool.length === Number(tail[1])) {
        const serverWords = server.replace(/[_-]+/g, ' ')
        const toolWords = tool.replace(/[_-]+/g, ' ')
        display = toolWords.startsWith(`${serverWords} `) ? toolWords : `${serverWords} ${toolWords}`
      }
    } else display = encoded
  }
  const words = display.replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_:/-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words === '' ? 'Tool' : words.charAt(0).toUpperCase() + words.slice(1)
}
