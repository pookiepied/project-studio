import { motion } from 'framer-motion'
import { SPRING_PANEL } from '@/app/motion'
import { useChrome } from '@/app/shell/ChromeProvider'
import { SHELL } from '@/app/shell/shellConfig'
import { useGatewayNavigation, type Section } from '@/app/navigation/GatewayNavigation'
import { Apps, Search, Code, Briefcase, Permission, Branch, Flask, Settings } from '@/components/icons'
import { cn } from '@/lib/utils'

type NavItem = { id: Section; label: string; icon: React.ElementType; group: 'operate' | 'configure' }

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Apps, group: 'operate' },
  { id: 'requests', label: 'Requests', icon: Search, group: 'operate' },
  { id: 'models', label: 'Models', icon: Code, group: 'configure' },
  { id: 'providers', label: 'Providers', icon: Briefcase, group: 'configure' },
  { id: 'tokens', label: 'API tokens', icon: Permission, group: 'configure' },
  { id: 'routing', label: 'Routing', icon: Branch, group: 'configure' },
  { id: 'health', label: 'Health', icon: Flask, group: 'operate' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'configure' },
]

export function GatewaySidebar({ onLogout }: { onLogout?: () => void }) {
  const { sidebarOpen, sidebarWidth } = useChrome()
  const { section, setSection } = useGatewayNavigation()

  return (
    <motion.div
      initial={false}
      animate={{ width: sidebarOpen ? sidebarWidth : 0, marginRight: sidebarOpen ? 0 : -SHELL.panelGap }}
      transition={SPRING_PANEL}
      className="relative min-h-0 shrink-0 overflow-hidden"
      aria-hidden={!sidebarOpen}
    >
      <motion.nav
        aria-label="Gateway navigation"
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -16, opacity: sidebarOpen ? 1 : 0 }}
        transition={SPRING_PANEL}
        className="flex h-full flex-col overflow-hidden border border-border bg-surface"
        style={{
          width: sidebarWidth,
          minWidth: SHELL.sidebar.minWidth,
          borderRadius: SHELL.panelRadius,
        }}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-[15px] leading-none">G</span>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium leading-none">Studio</div>
            <div className="font-editorial text-[11px] leading-none text-muted-foreground">Gateway</div>
          </div>
          <span className="ml-auto text-[10px] tracking-widest text-muted-foreground/60">v0.1</span>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-2">
          <NavGroup label="Operate" items={NAV.filter((i) => i.group === 'operate')} active={section} onSelect={setSection} />
          <NavGroup label="Configure" items={NAV.filter((i) => i.group === 'configure')} active={section} onSelect={setSection} />
        </div>

        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Gateway connected
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="grid size-5 place-items-center rounded-md bg-muted">A</span>
              <span className="flex flex-col">
                <span className="font-medium leading-none">Administrator</span>
                <span className="text-[11px] leading-none">Sign out</span>
              </span>
            </button>
          )}
        </div>
      </motion.nav>
    </motion.div>
  )
}

function NavGroup({
  label,
  items,
  active,
  onSelect,
}: {
  label: string
  items: NavItem[]
  active: Section
  onSelect: (s: Section) => void
}) {
  return (
    <div>
      <div className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">{label}</div>
      <div className="flex flex-col gap-px">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          const isPlanned = item.id === 'routing'
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                isPlanned && !isActive && 'opacity-60',
              )}
            >
              <Icon size="sm" className={cn(isActive && 'text-foreground')} />
              <span className="truncate">{item.label}</span>
              {isPlanned && <span className="ml-auto rounded border border-border px-1 py-0.5 text-[10px]">Soon</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
