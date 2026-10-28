import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { Button } from '@/components/primitives'
import { formatValue, type ChartVisual } from './parse'
import { VisualFrame, seriesColor } from './VisualFrame'

/**
 * A chart a reply draws: line, area, column or bar.
 *
 * Hand-drawn SVG on the app's own type and colour rather than a charting
 * library: the four forms are small, and a library brings its own look that
 * would then have to be argued back out of it. The marks follow one spec --
 * 2px lines, columns no wider than 24px with a 4px rounded end and a square
 * foot, a 10% wash under an area, hairline grid -- and text never wears a
 * series colour; identity comes from the swatch beside the name.
 *
 * Every chart has a table view. Three of the light series steps sit under 3:1
 * against white, and a reader who cannot tell two hues apart is owed the
 * numbers some other way than colour.
 */

const PLOT_HEIGHT = 200
const TOP = 10
const BOTTOM = 26
/** The micro type the axes are set in, measured once by eye: ~6px a glyph. */
const GLYPH = 6.2

export function Chart({ chart }: { chart: ChartVisual }) {
  const [table, setTable] = useState(false)
  const footer = chart.source !== undefined ? `Source: ${chart.source}` : undefined
  return (
    <VisualFrame
      title={chart.title}
      subtitle={chart.subtitle}
      footer={footer}
      actions={
        <Button size="xs" variant="ghost" onClick={() => setTable(!table)} label={table ? 'Show as chart' : 'Show as table'}>
          {table ? 'Chart' : 'Table'}
        </Button>
      }
    >
      {chart.series.length > 1 ? <Legend chart={chart} /> : null}
      {table ? <DataTable chart={chart} /> : chart.type === 'bar' && !hasNegative(chart) ? <Bars chart={chart} /> : <Plot chart={chart} />}
    </VisualFrame>
  )
}

function hasNegative(chart: ChartVisual): boolean {
  return chart.series.some((series) => series.values.some((value) => value !== null && value < 0))
}

function Legend({ chart }: { chart: ChartVisual }) {
  const line = chart.type === 'line'
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {chart.series.map((series, index) => (
        <span key={series.name + index} className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span
            aria-hidden
            className={line ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[2px]'}
            style={{ background: seriesColor(index) }}
          />
          {series.name}
        </span>
      ))}
    </div>
  )
}

function DataTable({ chart }: { chart: ChartVisual }) {
  return (
    <div className="studio-scroll-frame max-h-80 w-full min-w-0 overflow-auto rounded-xl bg-surface-sunken">
      <table>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Label</span></th>
            {chart.series.map((series, index) => <th key={series.name + index} scope="col" className="studio-num">{series.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {chart.x.map((label, row) => (
            <tr key={label + row}>
              <td>{label}</td>
              {chart.series.map((series, index) => {
                const value = series.values[row]
                return <td key={series.name + index} className="studio-num">{value === null ? '\u2013' : formatValue(value, chart.unit)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Horizontal bars: a ranking, label left, value at the tip. HTML, so the labels wrap like text. */
function Bars({ chart }: { chart: ChartVisual }) {
  const max = Math.max(...chart.series.flatMap((series) => series.values.map((value) => value ?? 0)), 0)
  const single = chart.series.length === 1
  return (
    <div role="list" className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
      {chart.x.map((label, row) => (
        <div role="listitem" key={label + row} className="contents">
          <span className="truncate text-caption text-foreground">{label}</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            {chart.series.map((series, index) => {
              const value = series.values[row]
              const share = max === 0 || value === null ? 0 : (value / max) * 100
              return (
                // The right padding is the room the value at the longest
                // tip spills into, so a bar's length stays its share.
                <div key={series.name + index} className="flex min-w-0 items-center gap-2 pr-16">
                  <div
                    className={single ? 'h-3.5 shrink-0 rounded-r-[4px]' : 'h-2.5 shrink-0 rounded-r-[4px]'}
                    style={{ width: `${share}%`, minWidth: value === null || value === 0 ? 0 : 2, background: seriesColor(index) }}
                  />
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                    {value === null ? '\u2013' : formatValue(value, chart.unit)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Round ticks covering [min, max]: 1, 2, 2.5 or 5 times a power of ten apart. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (min === 0) max = 1
    else if (min > 0) min = 0
    else max = 0
  }
  const rough = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude
  const low = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let value = low; value < max + step * 0.5; value += step) ticks.push(Number(value.toPrecision(12)))
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)))
  return ticks
}

/** A path for a rectangle rounded only at its data end. */
function columnPath(x: number, top: number, width: number, bottom: number, up: boolean): string {
  const height = Math.abs(bottom - top)
  const r = Math.min(4, width / 2, height)
  if (up) {
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`
  }
  return `M${x},${top}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + width - r}Q${x + width},${bottom} ${x + width},${bottom - r}V${top}Z`
}

function Plot({ chart }: { chart: ChartVisual }) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const columns = chart.type === 'column' || chart.type === 'bar'
  const values = chart.series.flatMap((series) => series.values.filter((value): value is number => value !== null))
  let min = Math.min(...values)
  let max = Math.max(...values)
  // Columns and areas are lengths from zero, so zero is always on the scale.
  // A line is a level, and only keeps zero when the data sits near it.
  if (columns || chart.type === 'area' || (min > 0 && min < max * 0.25)) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  const ticks = niceTicks(min, max)
  const low = ticks[0]
  const high = ticks[ticks.length - 1]
  const single = chart.series.length === 1
  const count = chart.x.length

  const tickLabels = ticks.map((tick) => formatValue(tick, chart.unit, true))
  const left = Math.max(...tickLabels.map((label) => label.length)) * GLYPH + 10
  const last = single ? lastValue(chart.series[0].values) : null
  const endLabel = !columns && last !== null ? formatValue(last.value, chart.unit, true) : null
  const right = endLabel === null ? 12 : endLabel.length * GLYPH + 16
  const plotWidth = Math.max(40, width - left - right)
  const height = TOP + PLOT_HEIGHT + BOTTOM
  const y = (value: number) => TOP + PLOT_HEIGHT - ((value - low) / (high - low || 1)) * PLOT_HEIGHT
  const band = plotWidth / count
  const x = (index: number) => columns
    ? left + band * index + band / 2
    : left + (count === 1 ? plotWidth / 2 : (index * plotWidth) / (count - 1))

  // Labels along x: as many as fit without touching.
  const labelWidth = Math.max(...chart.x.map((label) => label.length)) * GLYPH + 10
  const per = columns ? band : plotWidth / Math.max(1, count - 1)
  const every = Math.max(1, Math.ceil(labelWidth / per))

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const at = event.clientX - box.left
    const index = columns ? Math.floor(at / band) : Math.round((at / plotWidth) * (count - 1))
    setHover(Math.max(0, Math.min(count - 1, index)))
  }

  const baseline = y(Math.max(low, Math.min(0, high)))
  const barWidth = Math.max(2, Math.min(24, (band * 0.72 - (chart.series.length - 1) * 2) / chart.series.length))
  const groupWidth = chart.series.length * barWidth + (chart.series.length - 1) * 2

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={chart.title ?? 'Chart'}
        className="block max-w-full overflow-visible"
      >
        {ticks.map((tick, index) => (
          <g key={tick}>
            <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="var(--hairline)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[length:var(--text-micro)] tabular-nums">
              {tickLabels[index]}
            </text>
          </g>
        ))}

        {chart.x.map((label, index) => index % every === 0 ? (
          <text
            key={label + index}
            x={x(index)}
            y={TOP + PLOT_HEIGHT + 17}
            textAnchor={columns || count === 1 ? 'middle' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[length:var(--text-micro)]"
          >
            {label}
          </text>
        ) : null)}

        {columns && hover !== null ? (
          <rect x={left + band * hover} y={TOP} width={band} height={PLOT_HEIGHT} fill="var(--tint)" rx={4} />
        ) : null}

        {columns
          ? chart.series.map((series, s) => series.values.map((value, index) => {
            if (value === null) return null
            const start = x(index) - groupWidth / 2 + s * (barWidth + 2)
            const top = Math.min(y(value), baseline)
            const bottom = Math.max(y(value), baseline)
            if (bottom - top < 0.5) return null
            return <path key={`${s}-${index}`} d={columnPath(start, top, barWidth, bottom, value >= 0)} fill={seriesColor(s)} />
          }))
          : chart.series.map((series, s) => (
            <g key={series.name + s}>
              {chart.type === 'area' ? <path d={areaPath(series.values, x, y, baseline)} fill={seriesColor(s)} fillOpacity={0.1} /> : null}
              <path d={linePath(series.values, x, y)} fill="none" stroke={seriesColor(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}

        {!columns && last !== null ? (
          <g>
            <circle cx={x(last.index)} cy={y(last.value)} r={4} fill={seriesColor(0)} stroke="var(--surface-raised)" strokeWidth={2} />
            <text x={x(last.index) + 9} y={y(last.value)} dy="0.35em" className="fill-foreground text-[length:var(--text-micro)] font-medium tabular-nums">
              {endLabel}
            </text>
          </g>
        ) : null}

        {!columns && hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={TOP + PLOT_HEIGHT} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth={1} shapeRendering="crispEdges" />
            {chart.series.map((series, s) => {
              const value = series.values[hover]
              return value === null ? null : (
                <circle key={series.name + s} cx={x(hover)} cy={y(value)} r={4} fill={seriesColor(s)} stroke="var(--surface-raised)" strokeWidth={2} />
              )
            })}
          </g>
        ) : null}

        {/* The hit target: the whole plot, wider than any mark in it. */}
        <rect
          x={left}
          y={TOP}
          width={plotWidth}
          height={PLOT_HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null ? (
        <Readout chart={chart} index={hover} left={Math.min(x(hover) + 12, width - 180)} />
      ) : null}
    </div>
  )
}

function Readout({ chart, index, left }: { chart: ChartVisual; index: number; left: number }) {
  return (
    <div
      className="studio-blur pointer-events-none absolute top-2 z-10 min-w-28 rounded-lg px-2.5 py-2 text-caption shadow-overlay"
      style={{ left: Math.max(0, left) }}
    >
      <div className="mb-1 text-muted-foreground">{chart.x[index]}</div>
      {chart.series.map((series, s) => {
        const value = series.values[index]
        return (
          <div key={series.name + s} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: seriesColor(s) }} />
            {chart.series.length > 1 ? <span className="min-w-0 flex-1 truncate text-muted-foreground">{series.name}</span> : null}
            <span className="ml-auto pl-2 font-medium tabular-nums text-foreground">{value === null ? '\u2013' : formatValue(value, chart.unit)}</span>
          </div>
        )
      })}
    </div>
  )
}

function lastValue(values: readonly (number | null)[]): { index: number; value: number } | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== null) return { index, value }
  }
  return null
}

/** A line through the values, broken where one is missing rather than bridged. */
function linePath(values: readonly (number | null)[], x: (index: number) => number, y: (value: number) => number): string {
  let path = ''
  let open = false
  values.forEach((value, index) => {
    if (value === null) { open = false; return }
    path += `${open ? 'L' : 'M'}${x(index)},${y(value)}`
    open = true
  })
  return path
}

function areaPath(values: readonly (number | null)[], x: (index: number) => number, y: (value: number) => number, baseline: number): string {
  let path = ''
  let run: { index: number; value: number }[] = []
  const close = () => {
    if (run.length === 0) return
    path += `M${x(run[0].index)},${baseline}` + run.map((point) => `L${x(point.index)},${y(point.value)}`).join('') + `L${x(run[run.length - 1].index)},${baseline}Z`
    run = []
  }
  values.forEach((value, index) => { if (value === null) close(); else run.push({ index, value }) })
  close()
  return path
}
