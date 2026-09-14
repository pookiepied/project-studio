import type { ReactNode } from 'react'
import { GenericArtifact } from '@/features/artifacts/kinds/GenericArtifact'
import { MediaArtifact } from '@/features/artifacts/kinds/MediaArtifact'
import { WebResearchArtifact } from '@/features/artifacts/kinds/WebResearchArtifact'
import type { Artifact } from '@/domain/artifacts/types'

/**
 * Kind to renderer.
 *
 * ---- Why there is no family layer ----------------------------------------
 *
 * The design this came from had one: a hand-maintained map of about eighty
 * kinds onto ten families, and then families onto components. Every new tool
 * meant editing a table in the middle, and the table was already wrong in
 * places — `task_action` and `todoist_action` sat in different families for no
 * reason anybody could reconstruct. It was indirection that cost a maintenance
 * burden and bought nothing, because the families were never used for anything
 * except picking a component, which is what a map from kind to component does
 * directly.
 *
 * So: kinds map to renderers, aliases are just extra keys, and anything absent
 * falls to `GenericArtifact`, which renders from sections and is always
 * correct. Adding a renderer is one import and one line.
 */
type Renderer = (artifact: Artifact) => ReactNode

const RENDERERS: Readonly<Record<string, Renderer>> = {
  web_search: (artifact) => <WebResearchArtifact artifact={artifact} />,
  web_research: (artifact) => <WebResearchArtifact artifact={artifact} />,
  web_fetch: (artifact) => <WebResearchArtifact artifact={artifact} />,

  // Aliases rather than a normalisation step, because the alias list *is* the
  // knowledge — hiding it inside a rewrite makes it harder to find, not
  // cleaner.
  image_generation: (artifact) => <MediaArtifact artifact={artifact} video={false} />,
  generated_image: (artifact) => <MediaArtifact artifact={artifact} video={false} />,
  video_generation: (artifact) => <MediaArtifact artifact={artifact} video />,
  generated_video: (artifact) => <MediaArtifact artifact={artifact} video />,
}

export function renderArtifact(artifact: Artifact): ReactNode {
  const renderer = RENDERERS[artifact.kind]
  return renderer ? renderer(artifact) : <GenericArtifact artifact={artifact} />
}
