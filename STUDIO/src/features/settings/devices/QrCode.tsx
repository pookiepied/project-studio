import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A QR code, as an inline SVG.
 *
 * ---- Why it is drawn here rather than by the library ----------------------
 *
 * The library can write an `<img>` or an SVG string, and both would have to
 * be set as raw HTML. Drawing the modules ourselves is thirty lines and puts
 * the code in the document like everything else: it sizes with its container,
 * it needs no `dangerouslySetInnerHTML`, and a test can count its squares.
 *
 * ---- Why it is black on white in both themes ------------------------------
 *
 * The rest of the app inverts with the theme. This does not, on purpose. A
 * QR code is an object a phone camera reads, and while most scanners cope
 * with a light-on-dark code, not all do, and "the code did not scan in dark
 * mode" is a bug nobody should have to discover. The white card the code sits
 * on is the honest shape: a printed thing, the same on every screen.
 */
export function QrCode({
  value,
  size = 168,
  label,
}: {
  value: string
  /** The rendered edge, in CSS pixels. */
  size?: number
  /** What a screen reader says the picture is of. */
  label: string
}) {
  const modules = useMemo(() => modulesOf(value), [value])
  const count = modules.length
  // Four modules of quiet zone on every side, which the specification asks
  // for and which a camera needs to find the edge against a dark theme.
  const quiet = 4
  const edge = count + quiet * 2

  return (
    <svg
      role="img"
      aria-label={label}
      data-modules={count}
      viewBox={`0 0 ${edge} ${edge}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect width={edge} height={edge} fill="#fff" />
      <path d={pathOf(modules, quiet)} fill="#000" />
    </svg>
  )
}

/** The dark modules of the smallest code that holds `value`, row by row. */
function modulesOf(value: string): boolean[][] {
  // Type 0 lets the library pick the smallest version that fits; `M` is
  // the correction level a screen-to-camera read wants — enough to survive
  // a smudge on the glass, without the size cost of `H`.
  const code = qrcode(0, 'M')
  code.addData(value)
  code.make()
  const count = code.getModuleCount()
  const rows: boolean[][] = []
  for (let row = 0; row < count; row += 1) {
    const cells: boolean[] = []
    for (let column = 0; column < count; column += 1) {
      cells.push(code.isDark(row, column))
    }
    rows.push(cells)
  }
  return rows
}

/**
 * One path for every dark module, so the SVG is one element rather than a
 * few thousand. Horizontal runs are merged into one rectangle each, which
 * keeps the path short without changing what is drawn.
 */
function pathOf(modules: boolean[][], offset: number): string {
  const parts: string[] = []
  modules.forEach((cells, row) => {
    let column = 0
    while (column < cells.length) {
      if (!cells[column]) {
        column += 1
        continue
      }
      const start = column
      while (column < cells.length && cells[column]) column += 1
      const width = column - start
      parts.push(`M${start + offset} ${row + offset}h${width}v1h-${width}z`)
    }
  })
  return parts.join('')
}
