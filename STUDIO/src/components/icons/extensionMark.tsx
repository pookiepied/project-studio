import type { ReactNode } from 'react'
import { Icons } from '@/components/icons'
import type { McpServerRecord } from '@/platform/harness'

/**
 * The mark an extension row carries.
 *
 * MCP's own logo for anything a person installed - it is a published mark
 * and the honest sign of "a separate program speaking a protocol". The two
 * capabilities Studio ships over that same protocol are not that to the
 * person: the browser is Studio's browser and the computer is Studio's hand
 * on the desktop, so each carries Studio's own mark for the job, the same
 * one the transcript and the rail already use. A built-in row that reads as
 * "an MCP server" would be telling a person the plumbing when they asked
 * what it is.
 */
export function extensionMark(server: Pick<McpServerRecord, 'id' | 'provenance'>): ReactNode {
  if (server.provenance === 'system') {
    if (server.id === 'studio-browser') return <Icons.browserUse />
    if (server.id === 'studio-computer') return <Icons.computerUse />
  }
  return <Icons.mcp />
}
