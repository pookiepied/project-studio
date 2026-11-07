import type { IconSvgElement } from '@hugeicons/react'

/**
 * Family A's header marks, traced from the reference.
 *
 * The free Hugeicons set has no close match for these, so they are drawn
 * here on its 24-unit grid and in its data shape, and go through the same
 * `fromHugeicons` adapter as every other mark.
 */
const line = (key: string, d: string) =>
  ['path', { d, key, stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '1.5' }] as const

/**
 * Two editors' own logos, filled, from Simple Icons' published single-colour
 * paths. At full size and full ink they outweighed every line mark beside them,
 * so they are set at 90% of the box with the fill at 70%. The icon's own 1.5px
 * edge still draws at full ink around it, which keeps the shape crisp while the
 * body reads lighter.
 */
const logo = (d: string) => [['path', {
  d, key: 'mark', fill: 'currentColor', fillOpacity: '0.7', transform: 'translate(1.2 1.2) scale(0.9)',
}]] as unknown as IconSvgElement

export const VsCodeMark = logo('M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z')

export const CursorMark = logo('M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23')

/** A speech bubble wound back like a clock. */
export const HistoryMark = [
  line('bubble', 'M20.3 12.5A8.6 8.6 0 1 0 5.2 17.2L3.6 20.6l4.1-.9a8.6 8.6 0 0 0 9.2-.6'),
  line('head', 'M17.6 11.2l2.7 2 2.2-2.5'),
  line('hands', 'M11.4 8v4.4l2.5 1.6'),
] as unknown as IconSvgElement

/** A pencil leaving a rounded square. */
export const ComposeMark = [
  line('square', 'M12 3.8H8a4 4 0 0 0-4 4v8.4a4 4 0 0 0 4 4h8.4a4 4 0 0 0 4-4v-4'),
  line('pencil', 'M19.1 3.4a1.9 1.9 0 0 1 2.7 2.7l-8.6 9-3.9 1.1 1.1-3.9 8.7-8.9Z'),
] as unknown as IconSvgElement

/** Four corners of a frame around a plus. */
export const CaptureMark = [
  line('top-left', 'M4 9V8a4 4 0 0 1 4-4h1'),
  line('top-right', 'M15 4h1a4 4 0 0 1 4 4v1'),
  line('bottom-right', 'M20 15v1a4 4 0 0 1-4 4h-1'),
  line('bottom-left', 'M9 20H8a4 4 0 0 1-4-4v-1'),
  line('plus-down', 'M12 9.5v5'),
  line('plus-across', 'M9.5 12h5'),
] as unknown as IconSvgElement

/** A rounded frame holding a filled panel. */
export const PanelMark = [
  ['rect', { key: 'frame', x: '3.5', y: '3.5', width: '17', height: '17', rx: '5', stroke: 'currentColor', strokeWidth: '1.5' }],
  ['rect', { key: 'panel', x: '12', y: '7', width: '5.2', height: '10', rx: '1.6', fill: 'currentColor' }],
] as unknown as IconSvgElement

/** A line turning back on itself, as the quote strip leads with it. */
export const ReplyMark = [
  line('hook', 'M17.5 5.2H7.8a4.4 4.4 0 0 0 0 8.8H21'),
  line('head', 'M17 10l4 4-4 4'),
] as unknown as IconSvgElement

/** A closing pair of quotation marks, solid, as on the Reply pill. */
export const QuoteMark = [
  ['path', { key: 'left', fill: 'currentColor', d: 'M7 5.5a4.6 4.6 0 0 1 4.6 4.7c0 4.2-2.5 7.4-6.2 9.2-.7.3-1.3-.5-.8-1 1.1-1.2 1.9-2.5 2.2-4.1a4.6 4.6 0 0 1 .2-8.8Z' }],
  ['path', { key: 'right', fill: 'currentColor', d: 'M17.2 5.5a4.6 4.6 0 0 1 4.6 4.7c0 4.2-2.5 7.4-6.2 9.2-.7.3-1.3-.5-.8-1 1.1-1.2 1.9-2.5 2.2-4.1a4.6 4.6 0 0 1 .2-8.8Z' }],
] as unknown as IconSvgElement

/** One line with a head at each end. */
export const ExpandMark = [
  line('up', 'M14 4h6v6'),
  line('down', 'M10 20H4v-6'),
  line('between', 'M20 4 4 20'),
] as unknown as IconSvgElement
