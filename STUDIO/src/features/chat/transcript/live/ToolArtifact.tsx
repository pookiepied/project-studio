import { useMemo } from 'react'
import { PlaceMap } from '@/features/chat/markdown/visuals/PlaceMap'
import { StateNote } from '@/components/state'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { MediaCallArtifact } from './MediaCallArtifact'
import { QuestionAnswers } from './QuestionAnswers'
import { readMediaCall } from './mediaCall'
import { toolPresentation } from './toolPresentation'
import { readWalkingRoute } from './walkingRouteCall'

function WalkingRouteArtifact({ call, live }: { call: ToolCallView; live: boolean }) {
  const map = useMemo(() => readWalkingRoute(call), [call])
  if (map !== null) return <PlaceMap visual={map} />
  if (call.errorText !== null) return <StateNote title="Walking route unavailable" detail={call.errorText} />
  if (call.output?.present) return <StateNote title="This walking route could not be read." />
  return live ? <p role="status" className="my-3 text-caption text-muted-foreground">Calculating walking route…</p> : null
}

export function ToolArtifact({ call, conversationId, live = false, textBefore = false, textAfter = false, rowBefore = false }: {
  call: ToolCallView
  conversationId: string
  /** The turn is live, so a row arriving now takes the house entrance. */
  live?: boolean
  /** Words stand directly above or below; a row slot takes a tool row's margin. */
  textBefore?: boolean
  textAfter?: boolean
  /** Another row stands directly above, so a row slot takes the one row gap. */
  rowBefore?: boolean
}) {
  const artifact = toolPresentation(call.toolName).artifact
  if (artifact === 'answers') {
    return <QuestionAnswers call={call} live={live} textBefore={textBefore} textAfter={textAfter} rowBefore={rowBefore} />
  }
  if (artifact === 'walking-route') return <WalkingRouteArtifact call={call} live={live} />
  if (artifact !== 'media') return null
  const view = readMediaCall(call)
  return view === null ? null : <MediaCallArtifact call={call} view={view} conversationId={conversationId} />
}
