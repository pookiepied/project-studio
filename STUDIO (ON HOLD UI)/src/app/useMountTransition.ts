import { useEffect, useState } from 'react'

/**
 * Keep a component mounted long enough to animate out, then drop it.
 *
 * ── Why this exists instead of `AnimatePresence` ────────────────────────────
 *
 * On framer-motion 12.42 with React 19, `AnimatePresence` does not complete a
 * *conditional* removal. Given `{open && <motion.div exit=… />}`, flipping
 * `open` to false runs the exit animation to its final frame and then never
 * unmounts the child. It reproduces with the child keyed, unkeyed, with the
 * motion element as the direct child or nested, and in both `sync` and `wait`
 * modes. What does work is a *key swap* — a child that is always present and
 * only changes identity — which is why the view crossfade in `AppShell` and
 * the context-panel fade are still on `AnimatePresence` and are fine.
 *
 * The failure is not cosmetic. Every overlay in this app is `fixed inset-0`,
 * so a child stuck at `opacity: 0` is a full-window transparent sheet that
 * silently swallows every click afterwards. Open ⌘K once, dismiss it, and the
 * app appears to freeze.
 *
 * So conditional overlays own their own lifecycle: this hook reports `true`
 * from the moment they open until `exitMs` after they close, and the component
 * animates on `open` rather than on presence. It is a dozen lines, it cannot
 * get stuck, and it does not care what the animation library does.
 *
 * Revisit if a later framer-motion fixes conditional presence — but only
 * because the API is tidier, not because this is deficient.
 *
 * @param open   whether the surface should be showing
 * @param exitMs how long the leave animation takes, in milliseconds
 */
export function useMountTransition(open: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    // Already unmounted — nothing to wait for, and scheduling a timer here
    // would keep a closed surface re-rendering on every parent update.
    if (!mounted) return

    const timer = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [open, exitMs, mounted])

  return mounted
}
