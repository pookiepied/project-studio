import { AnimatePresence, motion } from 'framer-motion'
import { VIEW_TRANSITION } from '@/app/motion'
import { useChrome } from '@/app/shell/ChromeProvider'
import { ResizeHandle } from '@/app/shell/chrome/ResizeHandle'
import { SHELL } from '@/app/shell/shellConfig'
import { useGatewayNavigation } from '@/app/navigation/GatewayNavigation'
import { DashboardPage } from '@/pages/DashboardPage'
import { RequestsPage } from '@/pages/RequestsPage'
import { ModelsPage } from '@/pages/ModelsPage'
import { ProvidersPage } from '@/pages/ProvidersPage'
import { TokensPage } from '@/pages/TokensPage'
import { HealthPage } from '@/pages/HealthPage'
import { StudioMark } from '@/components/brand/StudioMark'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, Moon, Search, Settings, Sidebar, Sun } from '@/components/icons'
import { useTheme } from '@/app/theme/ThemeProvider'
import { GatewaySidebar } from '@/app/shell/sidebar/GatewaySidebar'

function FuturePage({ section }: { section: 'routing' | 'settings' }) {
  return (
    <div className="mx-auto max-w-[560px] px-6 py-16 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted">
        {section === 'routing' ? <ArrowUpRight size="md" className="text-muted-foreground" /> : <Settings size="md" className="text-muted-foreground" />}
      </div>
      <p className="mt-4 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
        {section === 'routing' ? 'ROUTING STUDIO' : 'WORKSPACE'}
      </p>
      <h1 className="font-display mt-2 text-2xl tracking-tight">
        {section === 'routing' ? 'Routing, without guesswork.' : 'Settings are coming together.'}
      </h1>
      <p className="font-editorial mx-auto mt-3 max-w-[420px] text-[13px] leading-relaxed text-muted-foreground">
        This surface is reserved for the next control-plane layer. Navigation is already part of the shell so routing and
        gateway preferences can arrive without reorganizing the workspace.
      </p>
    </div>
  )
}

function GatewayTitleBar() {
  const { toggleSidebar } = useChrome()
  const { theme, setTheme } = useTheme()
  return (
    <div
      className="flex shrink-0 items-center gap-2 bg-transparent"
      style={{ height: SHELL.titleBar.height, paddingLeft: SHELL.titleBar.paddingLeft, paddingRight: SHELL.titleBar.paddingRight }}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Toggle sidebar"
      >
        <Sidebar size="sm" />
      </button>
      <div className="flex items-center gap-2 text-muted-foreground">
        <StudioMark size={14} className="text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">Studio Gateway</span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Search" onClick={() => {}}>
          <Search size="sm" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'dark' : 'dark')}
        >
          {theme === 'dark' ? <Sun size="sm" /> : <Moon size="sm" />}
        </Button>
      </div>
    </div>
  )
}

export function GatewayShell({ onLogout }: { onLogout: () => void }) {
  const { sidebarOpen, sidebarWidth, setSidebarWidth, resetSidebarWidth } = useChrome()
  const { section, setSection } = useGatewayNavigation()

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-surface-sunken font-sans text-foreground"
      style={{
        borderRadius: SHELL.windowRadius,
        paddingLeft: SHELL.framePadding,
        paddingRight: SHELL.framePadding,
        paddingBottom: SHELL.framePadding,
      }}
    >
      <GatewayTitleBar />
      <div className="flex min-h-0 flex-1" style={{ gap: SHELL.panelGap }}>
        <GatewaySidebar onLogout={onLogout} />
        {sidebarOpen && (
          <ResizeHandle
            side="left"
            label="Resize sidebar"
            width={sidebarWidth}
            defaultWidth={SHELL.sidebar.defaultWidth}
            onResize={setSidebarWidth}
            onReset={resetSidebarWidth}
          />
        )}
        <main
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden border border-border bg-surface"
          style={{ borderRadius: SHELL.panelRadius }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={section} {...VIEW_TRANSITION} className="h-full min-h-0 overflow-y-auto">
              <div className="mx-auto max-w-[1200px] p-6 sm:p-8">
                {section === 'overview' && <DashboardPage onNavigate={setSection} />}
                {section === 'requests' && <RequestsPage />}
                {section === 'models' && <ModelsPage />}
                {section === 'providers' && <ProvidersPage />}
                {section === 'tokens' && <TokensPage />}
                {section === 'health' && <HealthPage />}
                {(section === 'routing' || section === 'settings') && <FuturePage section={section} />}
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
