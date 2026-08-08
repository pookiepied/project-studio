interface IconProps {
  size?: number;
  open?: boolean;
  filled?: boolean;
  className?: string;
}

export function NavToggleIcon({ size = 16, open = false, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" stroke="currentColor" strokeWidth="1.2" />
      <line
        x1="6.2"
        y1="2.5"
        x2="6.2"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.2"
        style={{ opacity: open ? 1 : 0.7 }}
      />
    </svg>
  );
}
