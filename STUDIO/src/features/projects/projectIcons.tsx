import type { ComponentType } from 'react'
import {
  Book,
  Briefcase,
  Camera,
  Code,
  Flask,
  Folder,
  Music,
  Palette,
  Rocket,
  type IconSize,
} from '@/components/icons'
import type { ProjectIconId } from '@/features/projects/types'

type ProjectIcon = ComponentType<{ size?: IconSize; className?: string }>

/**
 * The curated set a project can wear. Monochrome outline glyphs only — the
 * icon barrel's single-weight rule is what keeps the grid of cards quiet, and
 * colour is never how projects are told apart.
 */
export const PROJECT_ICONS: Record<ProjectIconId, ProjectIcon> = {
  folder: Folder,
  rocket: Rocket,
  palette: Palette,
  book: Book,
  code: Code,
  music: Music,
  camera: Camera,
  flask: Flask,
  briefcase: Briefcase,
}

export const PROJECT_ICON_IDS = Object.keys(PROJECT_ICONS) as ProjectIconId[]
