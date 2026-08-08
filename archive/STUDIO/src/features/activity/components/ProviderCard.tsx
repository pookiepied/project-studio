import { Warning } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { ProviderIcon, getProviderDisplayName } from "@/features/models/components/ProviderIcon";
import { fmtTokens, fmtCost } from "../formatters";
import type { UsageRow, CreditEntry } from "../types";

// Success-rate indicator — strict-neutral (D-401): strong dot ≥99, faint dot
// ≥95, Warning glyph below 95. The exact rate stays in the title tooltip.
const SuccessRateMark = ({ rate }: { rate: number }) => {
  const title = `${rate}% success rate`;
  if (rate < 95) {
    return (
      <span title={title} className="flex-shrink-0">
        <Warning size="xs" weight="fill" className="text-primary" />
      </span>
    );
  }
  return (
    <span
      title={title}
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${rate >= 99 ? "bg-primary" : "bg-muted"}`}
    />
  );
};

export const ProviderCard = ({
  row, credit, isActive, onClick,
}: {
  row: UsageRow;
  credit?: CreditEntry;
  isActive: boolean;
  onClick: () => void;
}) => {
  const hasCost = row.cost_usd != null && row.cost_usd > 0;
  const hasBalance = credit?.balance_usd != null;
  const sr = row.requests > 0 ? Math.round((row.success_count / row.requests) * 1000) / 10 : null;
  const balancePct = hasBalance && (credit!.purchased_usd ?? 0) > 0
    ? Math.min(((credit!.balance_usd ?? 0) / credit!.purchased_usd!) * 100, 100)
    : 0;

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`flex-shrink-0 w-36 !h-auto !gap-0 flex-col items-stretch border !px-2.5 py-2 text-left transition-colors duration-fast ${
        isActive
          ? "border-surface-border !bg-surface-selected"
          : "border-surface-border !bg-surface-base hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-2 h-[18px]">
        <ProviderIcon provider={row.label} size="md" />
        <span className="text-xs font-medium text-secondary truncate flex-1 min-w-0">
          {getProviderDisplayName(row.label)}
        </span>
        {sr != null && <SuccessRateMark rate={sr} />}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-baseline">
          <span className="text-2xs text-muted">Requests</span>
          <span className="text-xs font-medium text-secondary">{row.requests}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-2xs text-muted">Input</span>
          <span className="text-xs text-secondary">{fmtTokens(row.input_tokens)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-2xs text-muted">Output</span>
          <span className="text-xs text-secondary">{fmtTokens(row.output_tokens)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-2xs text-muted">Cost</span>
          <span className={`text-xs ${hasCost ? "text-secondary font-medium" : "text-disabled"}`}>
            {hasCost ? fmtCost(row.cost_usd, 3) : "N/A"}
          </span>
        </div>
        <div className="h-px bg-surface-border" />
        <div className="flex justify-between items-baseline">
          <span className="text-2xs text-muted">Balance</span>
          <span className={`text-xs font-medium ${hasBalance ? "text-secondary" : "text-disabled"}`}>
            {hasBalance ? fmtCost(credit!.balance_usd, 2) : "N/A"}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-border overflow-hidden">
          <div
            className="h-full rounded-full bg-secondary transition-all duration-normal"
            style={{ width: `${balancePct.toFixed(1)}%` }}
          />
        </div>
      </div>
    </Button>
  );
};
