import { Icons } from '@/components/icons'
import { isRecord } from '@/lib/guards'
import { StreamedMarkdown } from '@/features/chat/streaming'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { answerText, inputString } from '../callText'
import { ToolOutput, ToolResultPanel } from '../ToolResultPanel'
import { readableName } from '../toolResult'

export function AgentTaskDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  const input: unknown = call.input?.present ? call.input.value : null
  const agent = inputString(input, 'agent')
  const prompt = inputString(input, 'prompt')
  const output: unknown = call.output?.present ? call.output.value : null
  const text = answerText(output)
  return <ToolResultPanel title="Delegated work" call={call} live={live}>
    <p className="flex items-center gap-2 font-medium"><Icons.branch />{agent === null ? 'Agent' : readableName(agent)}</p>
    {prompt !== null ? <div><p className="mb-1 text-muted-foreground">Assigned work</p><p className="whitespace-pre-wrap">{prompt}</p></div> : null}
    {output !== null ? <div><p className="mb-1 text-muted-foreground">Agent response</p>
      {text !== '' ? <div className="studio-prose"><StreamedMarkdown text={text} streaming={false} /></div>
        : <ToolOutput value={isRecord(output) ? output : call.output?.value} />}
    </div> : <p className="text-muted-foreground">{live ? 'Waiting for the agent’s response.' : 'No agent response was recorded.'}</p>}
  </ToolResultPanel>
}
