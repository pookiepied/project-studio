import { useEffect, useState } from 'react'
import type { Options } from 'react-markdown'

/**
 * The maths pipeline, fetched the first time a reply carries a formula.
 *
 * KaTeX is the single largest thing the transcript can draw - the typesetter,
 * its stylesheet and twenty font files - and most conversations never write a
 * formula. So the two plugins that turn `$...$` into typeset maths, and the
 * stylesheet that draws it, live in a chunk that arrives on demand.
 *
 * The hint is cheap and generous: a dollar sign, or a `\(` / `\[` opener.
 * A price in a sentence trips it, and that is fine - the pipeline always ran
 * on every reply before this, so the false positive costs one fetch a session
 * rather than a wrong render. Until the chunk lands the reply renders without
 * the plugins, formula source and all, which is the honest picture of maths
 * that has not been typeset yet; the memoised markdown re-renders once when
 * the plugins arrive and the formula takes its place.
 *
 * Loaded once per session, held at module scope, so the second formula and
 * every one after it pays nothing.
 */

const HINT = /\$|\\\(|\\\[/

/** One entry of react-markdown's plugin lists; `unified` itself is not a dependency here. */
type Pluggable = NonNullable<Options['remarkPlugins']>[number]

interface MathPlugins {
  readonly remark: Pluggable
  readonly rehype: Pluggable
}

let loaded: MathPlugins | null = null
let loading: Promise<MathPlugins> | null = null

function loadMath(): Promise<MathPlugins> {
  loading ??= Promise.all([
    import('remark-math'),
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([remark, rehype]) => {
    loaded = { remark: remark.default, rehype: rehype.default }
    return loaded
  })
  return loading
}

/** The maths plugins for this text: `null` while they are not needed or not here yet. */
export function useMath(text: string): MathPlugins | null {
  const wanted = HINT.test(text)
  const [plugins, setPlugins] = useState<MathPlugins | null>(loaded)

  useEffect(() => {
    if (!wanted || plugins !== null) return
    let live = true
    void loadMath().then((ready) => {
      if (live) setPlugins(ready)
    })
    return () => {
      live = false
    }
  }, [wanted, plugins])

  return wanted ? plugins : null
}
