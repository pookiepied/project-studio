import './studio-mark.css'

export function StudioMark({
  busy = false,
  entrance = false,
  size = 16,
  className,
}: {
  busy?: boolean
  entrance?: boolean
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-studio-mark
      className={className ? `studio-mark ${className}` : 'studio-mark'}
      style={{ width: size, height: size }}
    >
      <span
        className="studio-mark-shape"
        data-motion={entrance ? 'enter' : busy ? 'busy' : undefined}
      />
    </span>
  )
}
