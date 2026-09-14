import { useState } from 'react'
import { Arriving } from '@/components/motion/Arrive'
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
      model: 'gpt-image-2',
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
      model: 'gpt-image-2',
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
      model: 'gpt-image-2',
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
      model: 'gpt-image-2',
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
      model: 'veo-3.1',
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
      note="A generation drawn as the object it made - frames reserved at the ratio asked for, filled as files land, sized by ratio in rows of two under one height cap - and research drawn as its steps. Same renderers as the transcript."
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
            <Arriving live>
            <div className="studio-prose flex flex-col">
              {renderArtifact(one(stage))}
              {renderArtifact(portrait(stage))}
              {renderArtifact(four(stage))}
              {renderArtifact(mixed(stage))}
              {renderArtifact(video(stage))}
              {renderArtifact(oneSearch(stage))}
              {renderArtifact(burst(stage))}
              {renderArtifact(page(stage))}
            </div>
            </Arriving>
          </RailProvider>
        </WorkspaceProvider>
      </NavigationProvider>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* Research                                                                    */
/* -------------------------------------------------------------------------- */

const HITS = [
  {
    title: 'DWM window corner preference',
    url: 'https://learn.microsoft.com/windows/apps/desktop/modernize/apply-rounded-corners',
    snippet: 'DWMWA_WINDOW_CORNER_PREFERENCE, and why a maximised window ignores it.',
  },
  {
    title: 'Tauri — window decorations',
    url: 'https://tauri.app/v2/reference/config/#windowconfig',
    snippet: 'decorations: false, transparency, and the platform caveats.',
  },
  {
    title: 'Why your transparent window has square corners',
    url: 'https://github.com/tauri-apps/tauri/issues/9749',
    snippet: 'The overflow that paints through a rounded edge.',
  },
  { title: 'Rounded corners on Windows 11 with WinUI', url: 'https://github.com/microsoft/microsoft-ui-xaml/issues/6421' },
  { title: 'Electron: transparent frameless corners', url: 'https://github.com/electron/electron/issues/28932' },
  { title: 'Windows App SDK release notes', url: 'https://learn.microsoft.com/windows/apps/windows-app-sdk/release-channels' },
  { title: 'Fluent design: geometry', url: 'https://learn.microsoft.com/windows/apps/design/signature-experiences/geometry' },
]

function stepStatus(stage: Stage, done: 'done' | 'failed' = 'done'): Stage {
  return stage === 'running' ? 'running' : stage === 'failed' ? 'failed' : done
}

function oneSearch(stage: Stage): Artifact {
  return {
    kind: 'web_research',
    id: 'show-search',
    title: 'tauri frameless window rounded corners windows 11',
    status: stage,
    source: { server: 'Brave' },
    data: {
      steps: [
        {
          kind: 'search',
          id: 's1',
          status: stage,
          query: 'tauri frameless window rounded corners windows 11',
          provider: 'Brave',
          hits: stage === 'done' ? HITS : [],
          ...(stage === 'failed' ? { error: 'No search provider is set. Choose one in Settings › Providers.' } : {}),
        },
      ],
    },
  }
}

function burst(stage: Stage): Artifact {
  const running = stage === 'running'
  return {
    kind: 'web_research',
    id: 'show-burst',
    title: 'tauri rounded corners and 3 more',
    status: stage,
    data: {
      steps: [
        {
          kind: 'search',
          id: 'b1',
          status: stage === 'failed' ? 'failed' : 'done',
          query: 'tauri rounded corners',
          provider: 'Brave',
          hits: stage === 'failed' ? [] : HITS.slice(0, 3),
          ...(stage === 'failed' ? { error: 'No search provider is set.' } : {}),
        },
        {
          kind: 'search',
          id: 'b2',
          status: running ? 'running' : stage === 'failed' ? 'failed' : 'done',
          query: 'DWMWA_WINDOW_CORNER_PREFERENCE maximised',
          provider: 'Brave',
          hits: running || stage === 'failed' ? [] : HITS.slice(3, 5),
          ...(stage === 'failed' ? { error: 'The search timed out.' } : {}),
        },
        {
          kind: 'search',
          id: 'b3',
          status: running ? 'running' : stage === 'failed' ? 'failed' : 'done',
          query: 'electron transparent window square corners',
          provider: 'Brave',
          hits: running || stage === 'failed' ? [] : [],
          ...(stage === 'failed' ? { error: 'The search timed out.' } : {}),
        },
        {
          kind: 'read',
          id: 'b4',
          status: running ? 'pending' : stepStatus(stage),
          url: 'https://learn.microsoft.com/windows/apps/desktop/modernize/apply-rounded-corners',
          ...(stage === 'done'
            ? {
                title: 'Apply rounded corners in desktop apps',
                provider: 'Jina',
                excerpt:
                  'Windows 11 rounds the corners of top-level windows. DwmSetWindowAttribute takes a preference of DWMWCP_DEFAULT, DWMWCP_DONOTROUND, DWMWCP_ROUND or DWMWCP_ROUNDSMALL. A maximised window is squared by the shell regardless of the preference…',
              }
            : {}),
          ...(stage === 'failed' ? { error: 'learn.microsoft.com is not an allowed destination.' } : {}),
        },
      ],
    },
  }
}

function page(stage: Stage): Artifact {
  return {
    kind: 'web_research',
    id: 'show-page',
    title: stage === 'done' ? 'Window customization' : 'tauri.app',
    status: stage,
    source: { server: 'Jina' },
    data: {
      steps: [
        {
          kind: 'read',
          id: 'p1',
          status: stage,
          url: 'https://tauri.app/v2/guides/window/customization',
          provider: 'Jina',
          ...(stage === 'done'
            ? {
                title: 'Window customization',
                excerpt:
                  'Tauri provides lots of options for customizing the look and feel of your app window. You can create custom titlebars, have transparent windows, enforce size constraints, and more.',
              }
            : {}),
          ...(stage === 'failed' ? { error: 'tauri.app could not be reached.' } : {}),
        },
      ],
    },
  }
}
