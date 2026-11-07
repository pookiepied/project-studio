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
