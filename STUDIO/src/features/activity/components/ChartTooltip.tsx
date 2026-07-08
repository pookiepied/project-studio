import { fmtShortDate, fmtMetricValue } from "../formatters";
import type { ChartMetric } from "../types";

export const ChartTooltip = ({
  active, payload, label, metric,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  metric: ChartMetric;
}) => {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="px-3 py-2 rounded-lg text-xs shadow-xl border bg-surface-raised border-surface-border text-primary">
      <div className="font-medium mb-0.5">{fmtShortDate(label)}</div>
      <div className="text-muted">{fmtMetricValue(metric, payload[0].value)}</div>
    </div>
  );
};
