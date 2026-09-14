import { useState } from 'react'
import { Segmented } from '@/components/primitives'
import { renderArtifact } from '@/features/artifacts'
import { GENERATED_IMAGE, GENERATED_VIDEO, GENERATED_VIDEO_POSTER } from '@/features/chat/gallery/marks'
import { NavigationProvider } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider } from '@/stores/workspace'
import type { Artifact } from '@/domain/artifacts/types'
import { Section } from './Section'

/**
 * The artifacts, at every stage and every shape.
 *
 * The gallery conversation shows each kind finished, once, at one ratio.
 * That leaves the states a real turn passes through unseen until a real
 * turn produces them: the frames reserved before a picture exists, four
 * pictures from one call, a portrait beside a landscape, a refusal. They
 * are all here, drawn by the same renderer the transcript uses, so a
 * change to a frame can be judged in every case it has to hold in.
 *
 * The stills are the gallery's own marks at other ratios - an SVG scales
 * to whatever box it is given, so one drawing stands in for a portrait, a
 * square and a wide frame without a second asset.
 */

type Stage = 'running' | 'done' | 'failed'

const STAGES: readonly { id: Stage; label: string }[] = [
  { id: 'running', label: 'Running' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
]

function still(ratio: string): string {
  // The gallery's picture, redrawn at another ratio by swapping its viewBox.
  const [w, h] = ratio.split(':').map(Number)
  return GENERATED_IMAGE.replace(
    encodeURIComponent('viewBox="0 0 800 600"'),
    encodeURIComponent(`viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" width="${String((w ?? 4) * 100)}" height="${String((h ?? 3) * 100)}"`),
  )
}

function one(stage: Stage): Artifact {
  return {
    kind: 'image_generation',
    id: 'show-one',
    title: 'A quiet abstract field, soft light from the upper left',
    status: stage,
    data: {
      model: 'studio-image-2',
      aspectRatio: '16:9',
      prompt:
        'A quiet abstract field, soft light from the upper left, muted blues and warm sand, no text anywhere in the frame.',
      ...(stage === 'done' ? { outputs: [{ url: still('16:9') }] } : {}),
      ...(stage === 'failed' ? { error: 'No image model is connected. Choose one in Settings › Providers.' } : {}),
    },
  }
}

function portrait(stage: Stage): Artifact {
  return {
    kind: 'image_generation',
    id: 'show-portrait',
    title: 'Poster study, tall',
    status: stage,
    data: {
      model: 'studio-image-2',
      aspectRatio: '9:16',
      ...(stage === 'done' ? { outputs: [{ url: still('9:16') }] } : {}),
      ...(stage === 'failed' ? { error: 'The provider refused the prompt.' } : {}),
    },
  }
}

function four(stage: Stage): Artifact {
  return {
    kind: 'image_generation',
    id: 'show-four',
    title: 'Four variations on the cover',
    status: stage,
    data: {
      model: 'studio-image-2',
      aspectRatio: '1:1',
      count: 4,
      detail: stage === 'running' ? 'Rendering' : undefined,
      ...(stage === 'done'
        ? { outputs: [{ url: still('1:1') }, { url: still('1:1') }, { url: still('1:1') }, { url: still('1:1') }] }
        : {}),
      ...(stage === 'failed' ? { error: 'The image could not be generated: quota exceeded.' } : {}),
    },
  }
}

function mixed(stage: Stage): Artifact {
  return {
    kind: 'image_generation',
    id: 'show-mixed',
    title: 'Two sizes from one call',
    status: stage,
    data: {
      model: 'studio-image-2',
      count: 3,
      ...(stage === 'done'
        ? {
            outputs: [
              { url: still('16:9'), aspectRatio: '16:9' },
              { url: still('9:16'), aspectRatio: '9:16' },
              { url: still('4:3'), aspectRatio: '4:3' },
            ],
          }
        : {}),
      ...(stage === 'failed' ? { error: 'The image could not be generated.' } : {}),
    },
  }
}

function video(stage: Stage): Artifact {
  return {
    kind: 'video_generation',
    id: 'show-video',
    title: 'Six-second loop for the splash',
    status: stage,
    data: {
      model: 'studio-motion-1',
      aspectRatio: '16:9',
      prompt: 'Slow drift across a gradient horizon, no camera shake, seamless loop.',
      detail: stage === 'running' ? 'Encoding' : undefined,
      ...(stage === 'done' ? { outputs: [{ url: GENERATED_VIDEO, poster: GENERATED_VIDEO_POSTER }] } : {}),
      ...(stage === 'failed' ? { error: 'The generation was stopped.' } : {}),
    },
  }
}

export function ArtifactsSection() {
  const [stage, setStage] = useState<Stage>('done')

  return (
    <Section
      title="Artifacts"
      note="A generation drawn as the object it made: frames reserved at the ratio asked for, filled as files land, sized by ratio in rows of two under one height cap. Same renderer as the transcript."
    >
      <div className="flex items-center gap-2">
        <span className="text-micro text-muted-foreground">Stage</span>
        <Segmented<Stage>
          layoutId="showcase-artifact-stage"
          ariaLabel="Artifact stage"
          value={stage}
          onChange={setStage}
          options={STAGES}
        />
      </div>
      <NavigationProvider>
        <WorkspaceProvider>
          <RailProvider>
            <div className="studio-prose flex flex-col">
              {renderArtifact(one(stage))}
              {renderArtifact(portrait(stage))}
              {renderArtifact(four(stage))}
              {renderArtifact(mixed(stage))}
              {renderArtifact(video(stage))}
            </div>
          </RailProvider>
        </WorkspaceProvider>
      </NavigationProvider>
    </Section>
  )
}
