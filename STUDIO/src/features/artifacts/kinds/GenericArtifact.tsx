import { Icons } from '@/components/icons'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { Sections, Stats } from '@/features/artifacts/sections'
import { isWorking, type Artifact } from '@/domain/artifacts/types'

/**
 * An artifact of a kind we have no renderer for.
 *
 * This is the most important file in the folder, which is not obvious. Every
 * other renderer here is a nicety for a kind we happened to design; this one
 * decides what happens for every kind we have not -- which, over the life of a
 * harness that keeps growing tools, is most of them.
 *
 * The failure it prevents is the one where a new tool ships, the client does
 * not know its `kind`, and the user gets a red box or a blank. Here they get
 * the title, the status, the summary and every section the artifact carried,
 * which is very often the whole of what the dedicated renderer would have
 * shown anyway.
 *
 * A consequence worth stating: writing a dedicated renderer is an *upgrade*,
 * never a prerequisite. The harness ships a tool and the client is already
 * correct.
 */
export function GenericArtifact({ artifact }: { artifact: Artifact }) {
  const working = isWorking(artifact.status)

  return (
    <ArtifactShell
      artifact={artifact}
      mark={<Icons.goal />}
      status={working ? 'Working' : STATUS_WORDS[artifact.status]}
    >
      {artifact.stats?.length ? (
        <div className="mb-3">
          <Stats items={artifact.stats} />
        </div>
      ) : null}

      {artifact.sections?.length ? <Sections sections={artifact.sections} /> : null}
    </ArtifactShell>
  )
}

const STATUS_WORDS: Record<Artifact['status'], string> = {
  pending: 'Queued',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}
