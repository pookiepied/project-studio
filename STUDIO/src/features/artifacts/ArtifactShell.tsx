import type { ReactNode } from 'react'
import { Arrive } from '@/components/motion/Arrive'
import { WorkingDots } from '@/components/state'
import { WorkingHalo } from '@/features/artifacts/ArtifactMotion'
import { isWorking, type Artifact } from '@/domain/artifacts/types'
import { cn } from '@/lib/cn'

/**
 * The frame every artifact sits in.
 *
 * In the design this grew out of, each artifact drew its own header: its own
 * icon bubble, its own title truncation, its own status line, its own footer
 * caption. Nine files, nine copies, and they had already drifted — different
 * gaps, different type sizes, two different ideas of where the summary goes.
 * That is the failure mode of an artifact system, and it is worth being blunt
 * about: if adding a kind means writing chrome, every kind's chrome is
 * slightly different and the transcript stops looking designed.
 *
 * So a kind supplies a mark, a status line and a body. Everything else —
 * layout, spacing, the working state, the provenance footer —
 * is here and is not negotiable per kind.
 *
 * ---- Why it is not a card ------------------------------------------------
 *
 * No border, no shadow, no fill by default. An artifact appears *inside a
 * reply*, often several in a row, and boxing each one turns the answer into a
 * stack of panels with prose wedged between them. It is set on the same
 * sunken ground the code block uses, which is enough to say "this is an
 * object" without saying "this is a separate document".
 */
export function ArtifactShell({
  artifact,
  mark,
  status,
  children,
  footer,
}: {
  artifact: Artifact
  /** The kind's own mark, drawn inside the shared bubble. */
  mark: ReactNode
  /** One line under the title: what is happening, or what happened. */
  status: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  const working = isWorking(artifact.status)
  const failed = artifact.status === 'failed'


  return (
    <Arrive className="group/artifact my-4 w-full min-w-0 overflow-hidden rounded-[20px] bg-surface-sunken p-3">
      <div className="flex items-start gap-2.5">
        <WorkingHalo working={working}>{mark}</WorkingHalo>

        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium text-foreground">{artifact.title}</p>

          <p
            className={cn(
              'mt-0.5 flex items-center text-caption',
              failed ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {status}
            {working ? <WorkingDots className="pl-1" /> : null}
          </p>
        </div>

      </div>

      {/* The summary belongs to the shell, not to the kind. It was drawn by
          each renderer before, at three different sizes. */}
      {artifact.summary ? (
        <p className="mt-2.5 text-ui text-muted-foreground">{artifact.summary}</p>
      ) : null}

      {children ? <div className="mt-3 min-w-0">{children}</div> : null}

      {/* Provenance, and only when there is something honest to say.
          "Studio" under everything is a watermark, not information. The server
          is worth naming because it answers "what reached out on my behalf",
          which is a question people actually have. */}
      {footer ?? (artifact.source?.server ? <Provenance server={artifact.source.server} /> : null)}
    </Arrive>
  )
}

function Provenance({ server }: { server: string }) {
  return <p className="mt-3 text-micro text-muted-foreground/70">via {server}</p>
}
