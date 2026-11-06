import { Icons } from '@/components/icons'
import { Button } from './Button'

export function ShowMoreButton({
  expanded, onToggle, moreLabel = 'Show more', lessLabel = 'Show fewer', className,
}: {
  expanded: boolean
  onToggle: () => void
  moreLabel?: string
  lessLabel?: string
  className?: string
}) {
  return <Button size="xs" expanded={expanded} onClick={onToggle} className={className}>
    {expanded ? lessLabel : moreLabel}
    <Icons.dropdown size="sm" className={expanded ? 'rotate-180' : undefined} />
  </Button>
}
