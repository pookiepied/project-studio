import { Icons } from '@/components/icons'
import { AnimatedItem, AnimatedList } from '@/features/artifacts/ArtifactMotion'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { Timeline, hostOf } from '@/features/artifacts/sections'
import { isWorking, type Artifact, type ArtifactLink } from '@/domain/artifacts/types'

/**
 * A search the model ran.
 *
 * The result rows are the artifact -- everything else is context for them --
 * so they get the space and the shell's summary line stays out of the way.
 *
 * ---- The favicon question -------------------------------------------------
 *
 * Real favicons would mean a network request per result, to a third-party
 * domain, from a desktop app, on every render of a transcript. That is a
 * tracking surface and a source of layout shift for a 16px decoration. A
 * letter in a disc identifies the source just as well at this size and asks
 * nothing of anyone.
 */
export function WebSearchArtifact({ artifact }: { artifact: Artifact }) {
  const links = artifact.sections?.find((section) => section.type === 'links')
  const results: readonly ArtifactLink[] = links?.type === 'links' ? links.items : []

  const timeline = artifact.sections?.find((section) => section.type === 'timeline')
  const working = isWorking(artifact.status)

  const query = typeof artifact.data?.query === 'string' ? artifact.data.query : artifact.title

  return (
    <ArtifactShell
      artifact={artifact}
      mark={<Icons.search />}
      status={
        working
          ? 'Searching'
          : `${results.length} ${results.length === 1 ? 'source' : 'sources'} for “${query}”`
      }
    >
      <AnimatedList className="gap-0.5">
        {results.map((result, index) => (
          <AnimatedItem key={result.href} index={index}>
            <a
              href={result.href}
              target="_blank"
              rel="noreferrer noopener"
              className="group/result flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-fast hover:bg-tint"
            >
              <Initial href={result.href} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui text-foreground">{result.label}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {hostOf(result.href)}
                </span>
                {result.description ? (
                  <span className="mt-1 line-clamp-2 block text-caption leading-relaxed text-muted-foreground">
                    {result.description}
                  </span>
                ) : null}
              </span>
              <Icons.openExternal className="mt-0.5 shrink-0 opacity-0 transition-opacity duration-fast group-hover/result:opacity-100" />
            </a>
          </AnimatedItem>
        ))}
      </AnimatedList>

      {timeline?.type === 'timeline' ? (
        <div className="mt-3">
          <Timeline items={timeline.items} />
        </div>
      ) : null}
    </ArtifactShell>
  )
}

function Initial({ href }: { href: string }) {
  const host = hostOf(href)
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-selected text-micro font-semibold text-muted-foreground"
    >
      {host.charAt(0).toUpperCase()}
    </span>
  )
}
