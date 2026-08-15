/**
 * Legacy Icon shim — delegates to the Studio icon barrel.
 * Keeps one import surface ( @/components/icons ) and one weight/size scale.
 * Pages still use <Icon name="..."> during migration; new code should import
 * semantic concepts directly from @/components/icons (e.g. `import { Search } from '@/components/icons'`).
 */
import {
  Activity,
  ArrowClockwise,
  ArrowUpRight,
  Buildings,
  Chart,
  Check,
  Clock,
  Coins,
  Copy,
  Cube,
  Database,
  Disclosure,
  Dots,
  Filter,
  Settings as Gear,
  Branch as GitBranch,
  Gauge,
  Key,
  Lightning,
  List,
  Lock,
  Monitor,
  Search as Magnifying,
  Info,
  Moon,
  Pause,
  Play,
  Plus,
  Permission as ShieldCheck,
  Sliders,
  Spinner,
  Grid,
  Stack,
  Sun,
  Trash,
  Trend,
  Users,
  Warning,
  Close,
  Upload,
  Preview as Eye,
} from '@/components/icons'
import type { IconSize } from '@/components/icons'

const map = {
  activity: Activity,
  arrowClockwise: ArrowClockwise,
  arrowUpRight: ArrowUpRight,
  buildings: Buildings,
  caretRight: Disclosure,
  chart: Chart,
  check: Check,
  clock: Clock,
  coins: Coins,
  copy: Copy,
  cube: Cube,
  database: Database,
  dots: Dots,
  eye: Eye,
  filter: Filter,
  gear: Gear,
  gitBranch: GitBranch,
  gauge: Gauge,
  key: Key,
  lightning: Lightning,
  list: List,
  lock: Lock,
  monitor: Monitor,
  magnifying: Magnifying,
  info: Info,
  moon: Moon,
  pause: Pause,
  play: Play,
  plus: Plus,
  shield: ShieldCheck,
  sliders: Sliders,
  spinner: Spinner,
  grid: Grid,
  stack: Stack,
  sun: Sun,
  trash: Trash,
  trend: Trend,
  users: Users,
  warning: Warning,
  close: Close,
  upload: Upload,
  app: Grid,
} as const

export type IconName = keyof typeof map

function toSize(size?: number): IconSize {
  if (size === undefined) return 'md'
  if (size <= 12) return 'xs'
  if (size <= 14) return 'sm'
  if (size <= 16) return 'md'
  if (size <= 20) return 'lg'
  return 'xl'
}

export function Icon({ name, size, className, ...props }: { name: IconName; size?: number; className?: string } & Omit<React.ComponentProps<typeof Activity>, 'size'>) {
  const Glyph = (map as Record<string, any>)[name] ?? Database
  return <Glyph size={toSize(size)} className={className} {...(props as any)} />
}
