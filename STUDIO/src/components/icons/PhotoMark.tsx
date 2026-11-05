import { createLucideIcon } from 'lucide-react'

/** A softer photo frame keeps the small artifact mark legible beside its title. */
export const PhotoMark = createLucideIcon('PhotoRounded', [
  ['rect', { x: '3', y: '3.5', width: '18', height: '17', rx: '4', key: 'frame' }],
  ['circle', { cx: '8', cy: '8.5', r: '1.35', key: 'sun' }],
  ['path', { d: 'm3.5 16 4.1-4.1a1.7 1.7 0 0 1 2.4 0l2.2 2.2 2.5-2.8a1.7 1.7 0 0 1 2.5 0l3.3 3.7', key: 'hills' }],
])
