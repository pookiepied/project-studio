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

export function OverviewIcon({ size = 15, filled = false, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="4"
        height="4"
        rx="0.9"
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
        fill={filled ? "currentColor" : "none"}
      />
      {filled && (
        <path d="M2.4 4.5l1 1 1.6-1.8" style={{ stroke: "var(--text-on-emphasis)" }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
      <line x1="7.5" y1="4.5" x2="14.5" y2="4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect
        x="1.5"
        y="9.5"
        width="4"
        height="4"
        rx="0.9"
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
        fill={filled ? "currentColor" : "none"}
      />
      {filled && (
        <path d="M2.4 11.5l1 1 1.6-1.8" style={{ stroke: "var(--text-on-emphasis)" }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
      <line x1="7.5" y1="11.5" x2="14.5" y2="11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
