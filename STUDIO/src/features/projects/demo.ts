/*
 * ============================================================================
 * DEMO — DELETE THIS FILE WHEN THE HARNESS LANDS.
 * ============================================================================
 *
 * Seed projects so the sidebar, the home grid and the workspace surfaces can be
 * built and reviewed before the backend exists. Everything here is in-memory
 * and talks to nothing; `ProjectsProvider` owns the live state and starts from
 * this list. A leftover should be obvious in the UI, not mistaken for real work.
 */
import type { Project } from '@/features/projects/types'

export const DEMO_PROJECTS: Project[] = [
  {
    id: 'demo-aurora',
    name: 'Aurora Film Score',
    icon: 'music',
    folders: ['~/Music/aurora', '~/Documents/scores'],
    chats: [
      { id: 'demo-aurora-theme', title: 'Theme variations' },
      { id: 'demo-aurora-orch', title: 'Orchestration questions' },
    ],
    notes: [
      {
        id: 'demo-aurora-note-1',
        title: 'Motif in the second reel',
        body: 'The four-note figure wants to come back under the dialogue scene, slower, on solo cello. Try it against the temp track before committing.',
        updatedAt: 'Mon',
      },
      {
        id: 'demo-aurora-note-2',
        title: 'Session links',
        body: 'Score drafts live in the scores folder. Reference mix: see the saved link in Files.',
        updatedAt: 'Sun',
      },
    ],
    tasks: [
      { id: 'demo-aurora-task-1', title: 'Sketch the cello variation', done: true },
      { id: 'demo-aurora-task-2', title: 'Send reel two to the director', done: false },
      { id: 'demo-aurora-task-3', title: 'Book the string session', done: false },
    ],
    files: [
      { id: 'demo-aurora-file-1', kind: 'link', name: 'Reference mix — reel two', meta: 'soundcloud.example' },
      { id: 'demo-aurora-file-2', kind: 'transcription', name: 'Director notes, voice memo', meta: '4:12' },
      { id: 'demo-aurora-file-3', kind: 'file', name: 'aurora-theme-v3.pdf', meta: '2.4 MB' },
    ],
  },
  {
    id: 'demo-studio-web',
    name: 'Studio Website',
    icon: 'palette',
    branch: 'main',
    branches: ['main', 'redesign/title-bar', 'fix/composer-radius'],
    folders: ['~/Projects/studio-web'],
    chats: [{ id: 'demo-web-copy', title: 'Landing page copy' }],
    notes: [
      {
        id: 'demo-web-note-1',
        title: 'Voice for the launch page',
        body: 'Short sentences. No adjectives that do not earn their place. The product is the screenshot, the words just get out of the way.',
        updatedAt: 'Tue',
      },
    ],
    tasks: [
      { id: 'demo-web-task-1', title: 'Draft the hero line', done: true },
      { id: 'demo-web-task-2', title: 'Screenshot the new sidebar', done: false },
    ],
    files: [
      { id: 'demo-web-file-1', kind: 'file', name: 'hero-mockup.png', meta: '1.1 MB' },
      { id: 'demo-web-file-2', kind: 'link', name: 'Type scale reference', meta: 'type-scale.example' },
    ],
  },
  {
    id: 'demo-research',
    name: 'Research Library',
    icon: 'book',
    folders: ['~/Documents/research', '~/Papers'],
    chats: [
      { id: 'demo-research-reading', title: 'Reading list' },
      { id: 'demo-research-localfirst', title: 'Summary: local-first software' },
    ],
    notes: [
      {
        id: 'demo-research-note-1',
        title: 'Local-first, one paragraph',
        body: 'Ownership of the bytes is the feature. Everything else — sync, collab, offline — falls out of that one decision.',
        updatedAt: 'Wed',
      },
      {
        id: 'demo-research-note-2',
        title: 'Papers to skim',
        body: 'CRDT survey, the Ink & Switch essays, and the new caching write-up. In that order.',
        updatedAt: 'Mon',
      },
    ],
    tasks: [
      { id: 'demo-research-task-1', title: 'Skim the CRDT survey', done: false },
      { id: 'demo-research-task-2', title: 'File annotations under Papers', done: false },
    ],
    files: [
      { id: 'demo-research-file-1', kind: 'link', name: 'Ink & Switch — local-first', meta: 'inkandswitch.example' },
      { id: 'demo-research-file-2', kind: 'file', name: 'crdt-survey.pdf', meta: '860 KB' },
    ],
  },
]
