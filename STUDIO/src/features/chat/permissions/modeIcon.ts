import { Icons, type IconComponent } from '@/components/icons'
import type { PermissionMode } from '@/domain/permissions/modes'

/**
 * The mark each execution mode wears in the picker and in settings.
 *
 * This is the drawing half of `domain/permissions/modes`, kept apart from it
 * so the domain stays what the README says it is - types and data, no React
 * and nothing from `components/`. The three glyphs are registry concepts
 * (shields, because permission is a shield), so this map is the only place
 * a mode is tied to one. A map rather than a function: a component looked up
 * during render must be the same object each time, and the lint checks that.
 */
export const PERMISSION_MODE_ICONS: Record<PermissionMode, IconComponent> = {
  manual: Icons.permissionManual,
  edits: Icons.permissionEdits,
  auto: Icons.permissionAuto,
}
