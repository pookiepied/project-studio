import { GENERATED_IMAGE, GENERATED_VIDEO_POSTER } from '@/domain/session/gallery/marks'
import type { Artifact } from '@/domain/artifacts/types'

/**
 * The gallery scene: every artifact the app can draw, at every stage.
 *
 * ---- Why this is a function of state rather than a list of strings -------
 *
 * The obvious way to demo a lifecycle is to write out the "searching" version
 * and the "found five sources" version and play them in order. That gives you
 * two copies of every artifact to keep in sync, and they drift the first time
 * anyone edits one -- which makes the demo lie about what the renderer does.
 *
 * So there is one description of each artifact, parameterised by its stage, and
 * the scene is rendered from a state object. Advancing the demo means changing
 * a field, and the "before" and "after" cannot disagree because there is only
 * one of them.
 *
 * This doubles as the fixture the renderers are checked against: if an artifact
 * looks wrong here it looks wrong everywhere, and it is one file to look at.
 */

export type Stage = 'pending' | 'running' | 'done'

export interface SceneState {
  readonly search: Stage
  readonly image: Stage
  readonly video: Stage
  readonly issue: Stage
  readonly mail: Stage
  readonly calendar: Stage
  readonly build: Stage
}

export const SCENE_START: SceneState = {
  search: 'pending',
  image: 'pending',
  video: 'pending',
  issue: 'pending',
  mail: 'pending',
  calendar: 'pending',
  build: 'pending',
}

export const SCENE_DONE: SceneState = {
  search: 'done',
  image: 'done',
  video: 'done',
  issue: 'done',
  mail: 'done',
  calendar: 'done',
  build: 'done',
}

/** A stage becomes an envelope status. `pending` artifacts are not drawn at all. */
function status(stage: Stage): Artifact['status'] {
  return stage === 'done' ? 'done' : 'running'
}

function fence(artifact: Artifact): string {
  return ['```artifact', JSON.stringify(artifact, null, 2), '```'].join('\n')
}

/**
 * A timeline whose steps resolve as the stage advances.
 *
 * Written once and reused, because "three steps, the last of which is running"
 * is the shape of nearly every tool's progress and duplicating it per artifact
 * is how the six of them would end up with six different rhythms.
 */
function steps(stage: Stage, labels: readonly string[]) {
  return labels.map((label, index) => ({
    label,
    status:
      stage === 'done'
        ? ('done' as const)
        : index === 0
          ? ('done' as const)
          : index === 1
            ? ('running' as const)
            : ('pending' as const),
  }))
}

function search(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'web_search',
    id: 'gallery-search',
    title: 'Frameless window corners on Windows 11',
    status: status(stage),
    summary: done
      ? 'The rounded corner is a DWM preference, not a CSS radius — and maximising squares it.'
      : undefined,
    source: { server: 'Brave Search' },
    data: { query: 'tauri frameless window rounded corners windows 11' },
    sections: [
      {
        type: 'links',
        items: done
          ? [
              {
                label: 'DWM window corner preference',
                href: 'https://learn.microsoft.com/windows/apps/desktop/modernize/apply-rounded-corners',
                description:
                  'DWMWA_WINDOW_CORNER_PREFERENCE, and why a maximised window ignores it.',
              },
              {
                label: 'Tauri — window decorations',
                href: 'https://tauri.app/v2/reference/config/#windowconfig',
                description: 'decorations: false, transparency, and the platform caveats.',
              },
              {
                label: 'Why your transparent window has square corners',
                href: 'https://github.com/tauri-apps/tauri/issues/9749',
                description: 'The overflow that paints through a rounded edge.',
              },
            ]
          : [],
      },
      {
        type: 'timeline',
        items: steps(stage, ['Query planned', 'Fetching sources', 'Reading results']),
      },
    ],
  }
}

function image(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'image_generation',
    id: 'gallery-image',
    title: 'Cover for the reading-measure note',
    status: status(stage),
    source: { server: 'Studio Images' },
    data: {
      model: 'studio-image-2',
      aspectRatio: '4 / 3',
      prompt:
        'A quiet abstract field, soft light from the upper left, muted blues and warm sand, no text.',
      url: done ? GENERATED_IMAGE : undefined,
    },
    sections: [
      { type: 'timeline', items: steps(stage, ['Prompt accepted', 'Rendering', 'Upscaling']) },
    ],
  }
}

function video(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'video_generation',
    id: 'gallery-video',
    title: 'Six-second loop for the splash',
    status: status(stage),
    source: { server: 'Studio Video' },
    data: {
      model: 'studio-motion-1',
      aspectRatio: '16 / 9',
      prompt: 'Slow drift across a gradient horizon, no camera shake, seamless loop.',
      poster: done ? GENERATED_VIDEO_POSTER : undefined,
    },
    sections: [
      {
        type: 'timeline',
        items: steps(stage, ['Storyboard', 'Rendering frames', 'Encoding']),
      },
    ],
  }
}

/**
 * Three artifacts with no dedicated renderer.
 *
 * They are in the gallery deliberately and they are the point of it: this is
 * what a tool that shipped in the harness this morning looks like in a client
 * that has never heard of it. If these read as broken, the fallback is broken,
 * and that matters far more than any single kind does.
 */
function issue(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'github_issue',
    id: 'gallery-issue',
    title: 'studio#412 — Composer reshapes on paste',
    status: status(stage),
    summary: done ? 'Opened against main, labelled bug and composer.' : undefined,
    source: { server: 'GitHub' },
    stats: done
      ? [
          { label: 'Number', value: '#412' },
          { label: 'State', value: 'Open' },
          { label: 'Labels', value: 'bug, composer' },
        ]
      : undefined,
    sections: [
      {
        type: 'text',
        content:
          'Pasting a long block into the composer holds the previous height for a frame, then snaps. The radius interpolates from 9999px, so it reads as a capsule for most of the transition.',
      },
      { type: 'timeline', items: steps(stage, ['Draft prepared', 'Creating issue', 'Applying labels']) },
    ],
  }
}

function mail(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'gmail_search',
    id: 'gallery-mail',
    title: 'Mail about the November type review',
    status: status(stage),
    source: { server: 'Gmail' },
    sections: [
      {
        type: 'table',
        title: 'Matches',
        table: {
          columns: ['From', 'Subject', 'When'],
          rows: done
            ? [
                ['Priya', 'Type review — notes before Thursday', '2 days ago'],
                ['Marcus', 'Re: measure and leading', '4 days ago'],
                ['Priya', 'Specimen sheets attached', 'last week'],
              ]
            : [],
        },
      },
      { type: 'timeline', items: steps(stage, ['Query built', 'Searching mailbox', 'Ranking']) },
    ],
  }
}

function calendar(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'calendar_availability',
    id: 'gallery-calendar',
    title: 'Free hours on Thursday',
    status: status(stage),
    summary: done ? 'Three windows over 45 minutes, all after the standup.' : undefined,
    source: { server: 'Google Calendar' },
    sections: [
      {
        type: 'list',
        items: done
          ? [
              { label: '10:30 – 11:30', description: 'Clear' },
              { label: '13:00 – 14:15', description: 'Clear, but adjacent to the design sync' },
              { label: '16:00 – 17:00', description: 'Clear' },
            ]
          : [],
      },
      { type: 'timeline', items: steps(stage, ['Reading calendars', 'Merging busy blocks', 'Finding gaps']) },
    ],
  }
}

function build(stage: Stage): Artifact {
  const done = stage === 'done'
  return {
    kind: 'work_summary',
    id: 'gallery-build',
    title: 'Composer paste behaviour',
    status: status(stage),
    summary: done ? 'Three files, and the reshape is gone.' : undefined,
    stats: done
      ? [
          { label: 'Files', value: 3 },
          { label: 'Added', value: 48 },
          { label: 'Removed', value: 12 },
        ]
      : undefined,
    sections: [
      {
        type: 'file_changes',
        title: 'Changes',
        items: done
          ? [
              {
                path: 'src/features/chat/composer/ComposerField.tsx',
                action: 'updated',
                additions: 22,
                deletions: 7,
              },
              { path: 'src/design/tokens/geometry.ts', action: 'updated', additions: 14, deletions: 3 },
              { path: 'src/features/chat/composer/Composer.tsx', action: 'updated', additions: 12, deletions: 2 },
            ]
          : [],
      },
      { type: 'timeline', items: steps(stage, ['Reading composer', 'Editing files', 'Checking types']) },
    ],
  }
}

const PROSE_INTRO = `Here is one of each, so the renderers can be seen side by side rather than hunted for.

Every card below is the same envelope — a fenced \`artifact\` block holding JSON — and the only thing that differs is the \`kind\`. Watch the statuses resolve: each one runs, then finishes, in the order a real turn would produce them.`

const PROSE_FALLBACK = `### Kinds with no renderer of their own

The three above have dedicated components. The three below do not, and are drawn entirely from their \`sections\` by the generic fallback. This is what a tool that shipped in the harness this morning looks like in a client that has never heard of it — which is the case that has to stay good, because over time it is most of them.`

const PROSE_CLOSE = `### And the rest of the transcript

A table with room to breathe:

| Kind | Renderer | Falls back |
| --- | --- | --- |
| \`web_search\` | dedicated | no |
| \`image_generation\` | dedicated | no |
| \`github_issue\` | none yet | yes, and it reads fine |

A code block, folded past twenty lines and hover-revealing its controls:

\`\`\`ts
export function segment(text: string, settled: boolean): Segments {
  if (text.length === 0) return { stable: [], tail: '' }

  const blocks = coalesce(blocksOf(text))
  if (blocks.length === 0) return { stable: [], tail: '' }

  if (settled) return { stable: blocks.map((block) => block.text), tail: '' }

  const last = blocks[blocks.length - 1]
  return {
    stable: blocks.slice(0, -1).map((block) => block.text),
    tail: last.open ? closeOpenFence(last.text) : last.text,
  }
}
\`\`\`

And a text block, which is what a rewrite arrives in so you can take it without selecting around it:

\`\`\`draft
The window is one rounded panel. There is no tray and no inset, so there is exactly one radius in the shell — matched by the corner preference the compositor is given, because two radii is how a frameless window ends up with arcs that cross.
\`\`\``

/**
 * Render the whole reply for a given state.
 *
 * Artifacts at `pending` are omitted rather than drawn as empty cards, so the
 * gallery builds up the way a real reply does -- text first, then each object
 * as the model gets to it.
 */
export function renderScene(state: SceneState): string {
  const parts: string[] = [PROSE_INTRO]

  if (state.search !== 'pending') parts.push(fence(search(state.search)))
  if (state.image !== 'pending') parts.push(fence(image(state.image)))
  if (state.video !== 'pending') parts.push(fence(video(state.video)))

  if (state.issue !== 'pending' || state.mail !== 'pending' || state.calendar !== 'pending') {
    parts.push(PROSE_FALLBACK)
  }

  if (state.issue !== 'pending') parts.push(fence(issue(state.issue)))
  if (state.mail !== 'pending') parts.push(fence(mail(state.mail)))
  if (state.calendar !== 'pending') parts.push(fence(calendar(state.calendar)))

  if (state.build !== 'pending') parts.push(fence(build(state.build)))

  if (state.build === 'done') parts.push(PROSE_CLOSE)

  return parts.join('\n\n')
}

/**
 * The order things happen in, and when.
 *
 * Overlapping on purpose: two artifacts are working at once for part of it,
 * because that is what a real turn looks like and because a demo that resolves
 * each card before starting the next never exercises the case where several
 * are animating together.
 */
export const SCENE_SCRIPT: readonly { readonly at: number; readonly patch: Partial<SceneState> }[] =
  [
    { at: 300, patch: { search: 'running' } },
    { at: 2200, patch: { search: 'done', image: 'running' } },
    { at: 4200, patch: { video: 'running' } },
    { at: 5200, patch: { image: 'done' } },
    { at: 7000, patch: { video: 'done', issue: 'running' } },
    { at: 8200, patch: { mail: 'running' } },
    { at: 9200, patch: { issue: 'done', calendar: 'running' } },
    { at: 10400, patch: { mail: 'done' } },
    { at: 11400, patch: { calendar: 'done', build: 'running' } },
    { at: 13600, patch: { build: 'done' } },
  ]
