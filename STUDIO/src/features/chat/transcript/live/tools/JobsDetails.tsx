import { Icons } from '@/components/icons'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { answerText } from '../callText'
import { ToolOutput, ToolResultPanel } from '../ToolResultPanel'
import { jobReports } from './jobReports'
import { resultState } from '../toolResult'

export function JobsDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  const output: unknown = call.output?.present ? call.output.value : null
  const text = answerText(output)
  const reports = jobReports(text)
  const tail = reports.length === 1 ? text.split('\n').slice(1).join('\n').trim() : ''
  return <ToolResultPanel title="Background work" call={call} live={live}
    {...(resultState(call, live) === 'success' ? { statusLabel: 'Checked' } : {})}>
    {reports.length > 0 ? <ul className="flex flex-col gap-3">{reports.map((report) => {
      const failed = report.state.startsWith('failed') || /^exited (?!0$)-?\d+$/.test(report.state)
      const state = report.state === 'exited 0' || report.state === 'done' || report.state === 'finished' ? 'Finished' : report.state === 'running' ? 'Running when checked'
        : report.state === 'generating' ? 'Generating when checked' : report.state === 'queued' ? 'Queued when checked'
        : report.state === 'stopped' ? 'Stopped' : report.state
      return <li key={report.id} className="flex items-start gap-2.5">
        <span className={failed ? 'mt-0.5 text-danger' : 'mt-0.5 text-muted-foreground'}>{failed ? <Icons.failed /> : <Icons.backgroundJobs />}</span>
        <div className="min-w-0"><p className="whitespace-pre-wrap font-medium">{report.command}</p>
          <p className={failed ? 'text-danger' : 'text-muted-foreground'}>{state}</p>
          <p className="text-muted-foreground">Job {report.id}</p>
        </div>
      </li>
    })}</ul> : output !== null ? <ToolOutput value={output} /> : null}
    {tail !== '' ? <div className="whitespace-pre-wrap font-mono text-code text-muted-foreground">{tail}</div> : null}
  </ToolResultPanel>
}
