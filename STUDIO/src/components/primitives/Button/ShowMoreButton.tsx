import { cn } from '@/lib/cn'

export function ShowMoreButton({
  expanded, onToggle, moreLabel = 'Show more', lessLabel = 'Show fewer', className,
}: {
  expanded: boolean
  onToggle: () => void
  moreLabel?: string
  lessLabel?: string
  className?: string
}) {
  return <button type="button" aria-expanded={expanded} onClick={onToggle}
    className={cn('inline-flex rounded-md border border-border px-2 py-0.5 text-caption font-medium text-muted-foreground',
      'transition-colors duration-fast hover:bg-tint hover:text-foreground active:bg-selected focus-visible:ring-2 focus-visible:ring-ring',
      className)}>
    {expanded ? lessLabel : moreLabel}
  </button>
}
