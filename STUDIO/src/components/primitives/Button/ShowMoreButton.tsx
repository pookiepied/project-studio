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
  return <Button size="xs" expanded={expanded} onClick={onToggle} className={className}
    icon={<Icons.disclosure state={expanded ? 'on' : 'rest'} />}>
    {expanded ? lessLabel : moreLabel}
  </Button>
}
