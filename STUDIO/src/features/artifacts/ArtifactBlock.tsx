import { Icons } from '@/components/icons'
import { WorkingHalo } from '@/features/artifacts/ArtifactMotion'
import { renderArtifact } from '@/features/artifacts/registry'
import { parseArtifact } from '@/domain/artifacts/parse'

/**
 * The bridge from an ```artifact fence to a rendered artifact.
 *
 * The only place in the app that knows artifacts arrive as text. Everything
 * downstream takes a parsed `Artifact`, so the transport could change to a
 * side-channel event tomorrow and only this file would notice.
 *
 * ---- The three states, and why the middle one is silent ------------------
 *
 * This runs on every frame of a stream, which means it spends most of an
 * artifact's life holding a JSON document that is not finished arriving. That
 * is not an error, and showing one would put a red message in the transcript
 * that flickers for a second and then resolves itself -- which is worse than
 * showing nothing at all, because the user has already started reading it.
 *
 * So a half-arrived artifact renders as a placeholder that occupies the shape
 * the real one will take, and only a document that is *complete and wrong*
 * says anything.
 */
export function ArtifactBlock({ source }: { source: string }) {
  const result = parseArtifact(source)

  if (result.kind === 'artifact') return <>{renderArtifact(result.artifact)}</>

  if (result.kind === 'pending') return <Arriving />

  return (
    <div className="my-4 flex items-start gap-2.5 rounded-xl bg-surface-sunken p-3">
      <span className="mt-0.5 text-danger">
        <Icons.failed />
      </span>
      <div className="min-w-0">
        <p className="text-ui text-foreground">This artifact could not be read</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{result.message}</p>
      </div>
    </div>
  )
}

/**
 * The shape of an artifact that has not finished arriving.
 *
 * Same frame, same padding, same bubble position as the real thing, so when the
 * artifact resolves the only change is the content -- not the geometry. A
 * placeholder of a different size guarantees a jump at the exact moment the
 * artifact appears, which is precisely when the eye is on it.
 */
function Arriving() {
  return (
    <div className="my-4 w-full min-w-0 rounded-xl bg-surface-sunken p-3">
      <div className="flex items-start gap-2.5">
        <WorkingHalo working>
          <Icons.goal />
        </WorkingHalo>
        <div className="min-w-0 flex-1">
          <div className="h-[1.15em] w-40 rounded bg-selected" />
          <div className="mt-1.5 h-[1em] w-24 rounded bg-selected/70" />
        </div>
      </div>
    </div>
  )
}
