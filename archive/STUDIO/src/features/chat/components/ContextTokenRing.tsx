interface TokenRingProps {
  usedTokens: number;
  maxTokens: number;
  size?: number;
  stroke?: number;
  className?: string;
  active?: boolean;
}

export function TokenRing({
  usedTokens,
  maxTokens,
  size = 38,
  stroke = 2.5,
  className = "",
  active = true,
}: TokenRingProps) {
  if (maxTokens === 0) return null;

  const percentage = Math.min(usedTokens / maxTokens, 1);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - percentage);
  const progressStroke = percentage >= 0.9
    ? "var(--marker)"
    : percentage >= 0.7
    ? "var(--text-secondary)"
    : active
    ? "var(--text-secondary)"
    : "var(--text-muted)";

  const usedK = usedTokens >= 1000 ? `${(usedTokens / 1000).toFixed(1)}K` : `${usedTokens}`;
  const maxK  = maxTokens  >= 1000 ? `${(maxTokens  / 1000).toFixed(0)}K` : `${maxTokens}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`block shrink-0 pointer-events-none ${className}`}
      role="img"
      aria-label={`Context: ${usedK} of ${maxK} tokens`}
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--text-disabled)" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={progressStroke}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}
