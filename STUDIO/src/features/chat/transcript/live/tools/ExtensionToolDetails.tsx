import type { ToolCallView } from '@/features/chat/transcript/projection'
import { StructuredValue, ToolOutput, ToolResultPanel } from '../ToolResultPanel'
import { readableName } from '../toolResult'

/** Shared MCP protocol presentation, including Studio's built-in servers. */
export function ExtensionToolDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  return <ToolResultPanel title={readableName(call.toolName)} call={call} live={live}>
    {call.input?.present ? <div><p className="mb-1 text-muted-foreground">Request</p><StructuredValue value={call.input.value} /></div> : null}
    {call.output?.present ? <ToolOutput value={call.output.value} /> : null}
  </ToolResultPanel>
}
