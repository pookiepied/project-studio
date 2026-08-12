import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { SHELL } from '@/app/shell/shellConfig'

const STORAGE_KEY = 'studio-chrome-layout'

interface StoredLayout {
  sidebarWidth: number
  contextWidth: number
  sidebarOpen: boolean
  contextOpen: boolean
}

interface ChromeContextValue {
  /** Left sidebar — the Studio navigator. Open in the resting layout. */
  sidebarOpen: boolean
  toggleSidebar: () => void
  /** Right panel — context for whatever is open. Closed until asked for. */
  contextOpen: boolean
  toggleContext: () => void

  /**
   * Panel widths. The centre surface has no width of its own — it is whatever
   * is left — so resizing either rail *is* resizing the centre. That is why
   * there is no third number here and no handle in the middle.
   */
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  contextWidth: number
  setContextWidth: (width: number) => void
  /** Snap a rail back to its designed width. Bound to double-click on a handle. */
  resetSidebarWidth: () => void
  resetContextWidth: () => void

  /** The ⌘K command palette. Takes an updater so the shortcut can toggle it
   *  without first reading the value it is about to invert. */
  commandOpen: boolean
  setCommandOpen: Dispatch<SetStateAction<boolean>>

  /** The New Project sheet, openable from the sidebar, ⌘K, and the home grid. */
  newProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
}

const ChromeContext = createContext<ChromeContextValue | null>(null)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Read the persisted layout, clamping every number back into range.
 *
 * The clamp is not paranoia about corrupt storage — it is what happens when the
 * min/max in `shellConfig` change in a later build and a user still has the old
 * width on disk. Without it, a stale value silently wins over the new design.
 */
function readLayout(): StoredLayout {
  const fallback: StoredLayout = {
    sidebarWidth: SHELL.sidebar.defaultWidth,
    contextWidth: SHELL.contextPanel.defaultWidth,
    sidebarOpen: true,
    contextOpen: false,
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredLayout>
    return {
      sidebarWidth: clamp(
        Number(parsed.sidebarWidth) || fallback.sidebarWidth,
        SHELL.sidebar.minWidth,
        SHELL.sidebar.maxWidth,
      ),
      contextWidth: clamp(
        Number(parsed.contextWidth) || fallback.contextWidth,
        SHELL.contextPanel.minWidth,
        SHELL.contextPanel.maxWidth,
      ),
      sidebarOpen: parsed.sidebarOpen ?? fallback.sidebarOpen,
      contextOpen: parsed.contextOpen ?? fallback.contextOpen,
    }
  } catch {
    return fallback
  }
}

/**
 * Owns the shell's moving parts: which rails are showing, how wide they are,
 * and whether the palette or the New Project sheet is up.
 *
 * Widths live here rather than in the panels because two things need them at
 * once — the panel and its resize handle — and because they persist. A rail
 * that forgets its width on every launch is a rail you resize once and then
 * stop touching.
 */
export function ChromeProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<StoredLayout>(readLayout)
  const [commandOpen, setCommandOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  // Persisted on every change rather than on unload: a desktop window is
  // usually closed by the OS, and `beforeunload` in a WebView is not a promise
  // worth relying on.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      /* storage unavailable — layout stays session-only */
    }
  }, [layout])

  const toggleSidebar = useCallback(
    () => setLayout((current) => ({ ...current, sidebarOpen: !current.sidebarOpen })),
    [],
  )
  const toggleContext = useCallback(
    () => setLayout((current) => ({ ...current, contextOpen: !current.contextOpen })),
    [],
  )

  const setSidebarWidth = useCallback((width: number) => {
    setLayout((current) => ({
      ...current,
      sidebarWidth: clamp(width, SHELL.sidebar.minWidth, SHELL.sidebar.maxWidth),
    }))
  }, [])

  const setContextWidth = useCallback((width: number) => {
    setLayout((current) => ({
      ...current,
      contextWidth: clamp(width, SHELL.contextPanel.minWidth, SHELL.contextPanel.maxWidth),
    }))
  }, [])

  const resetSidebarWidth = useCallback(
    () => setLayout((current) => ({ ...current, sidebarWidth: SHELL.sidebar.defaultWidth })),
    [],
  )
  const resetContextWidth = useCallback(
    () => setLayout((current) => ({ ...current, contextWidth: SHELL.contextPanel.defaultWidth })),
    [],
  )

  const value = useMemo<ChromeContextValue>(
    () => ({
      sidebarOpen: layout.sidebarOpen,
      toggleSidebar,
      contextOpen: layout.contextOpen,
      toggleContext,
      sidebarWidth: layout.sidebarWidth,
      setSidebarWidth,
      contextWidth: layout.contextWidth,
      setContextWidth,
      resetSidebarWidth,
      resetContextWidth,
      commandOpen,
      setCommandOpen,
      newProjectOpen,
      setNewProjectOpen,
    }),
    [
      layout,
      toggleSidebar,
      toggleContext,
      setSidebarWidth,
      setContextWidth,
      resetSidebarWidth,
      resetContextWidth,
      commandOpen,
      newProjectOpen,
    ],
  )

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
}

export function useChrome(): ChromeContextValue {
  const context = useContext(ChromeContext)
  if (!context) throw new Error('useChrome must be used within ChromeProvider')
  return context
}
