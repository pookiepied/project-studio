import {
  ChatCircleIcon as ChatCircle,
  EyeIcon as Eye,
  WrenchIcon as Wrench,
  HardDrivesIcon as HardDrives,
  LeafIcon as Leaf,
} from "@phosphor-icons/react";
import { Icon } from "@/components/icons";
import { ProviderIcon, getProviderDisplayName } from "@/components/ProviderIcon";
import type { Model } from "@/services/ai/modelService";
import {
  isFreeModel, isVisionModel, hasTools, hasReasoning,
  formatCtx, formatModelPrice, getPriceSummary, getModelSubtitle, TYPE_LABELS,
} from "../../helpers";
import { CapabilityPill } from "./FilterButton";

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-border px-3 py-2">
      <div className="text-2xs text-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-secondary tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

function TokenList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <span className="text-xs text-muted">Unknown</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 10).map((item) => (
        <span
          key={item}
          className="rounded-md bg-surface-raised px-2 py-1 text-2xs text-secondary"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function ModelDetail({
  model,
  selected,
  selectable,
  onSelect,
}: {
  model?: Model;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  if (!model) {
    return (
      <aside className="border-l border-surface-border p-5 flex items-center justify-center text-center">
        <p className="text-sm text-muted">No model selected</p>
      </aside>
    );
  }

  const free = isFreeModel(model);
  const vision = isVisionModel(model);
  const tools = hasTools(model);
  const reasoning = hasReasoning(model);
  const inputTypes = model.inputTypes ?? (vision ? ["text", "image"] : ["text"]);
  const outputTypes = model.outputTypes ?? ["text"];

  return (
    <aside className="hidden lg:block border-l border-surface-border bg-surface-base overflow-y-auto scrollbar-auto-hide">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <ProviderIcon provider={model.provider} modelId={model.id} size="md" />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-display text-primary leading-tight truncate">
              {model.name}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {getModelSubtitle(model)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <CapabilityPill icon={<Icon icon={ChatCircle} size="xs" />} label={TYPE_LABELS[model.type]} active />
          <CapabilityPill icon={<Icon icon={Eye} size="xs" />} label="Vision" active={vision} />
          <CapabilityPill icon={<Icon icon={Wrench} size="xs" />} label="Tools" active={tools} />
          <CapabilityPill icon={<span className="text-2xs leading-none">R</span>} label="Reasoning" active={reasoning} />
          <CapabilityPill icon={<Icon icon={Leaf} size="xs" />} label="Free" active={free} />
          <CapabilityPill icon={<Icon icon={HardDrives} size="xs" />} label="Local" active={model.provider === "local"} />
        </div>

        {model.description && (
          <p className="mt-4 text-sm leading-6 text-secondary">
            {model.description}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <DetailMetric label="Context" value={formatCtx(model.contextWindow)} />
          <DetailMetric label="Max output" value={model.maxTokens ? formatCtx(model.maxTokens) : "Unknown"} />
          <DetailMetric label="Input / 1M" value={free ? "Free" : formatModelPrice(model.pricing?.input)} />
          <DetailMetric label="Output / 1M" value={free ? "Free" : formatModelPrice(model.pricing?.output)} />
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-extra-wide text-muted">Input</div>
            <div className="mt-2"><TokenList items={inputTypes} /></div>
          </div>
          <div>
            <div className="text-2xs font-semibold uppercase tracking-extra-wide text-muted">Output</div>
            <div className="mt-2"><TokenList items={outputTypes} /></div>
          </div>
          <div>
            <div className="text-2xs font-semibold uppercase tracking-extra-wide text-muted">Capabilities</div>
            <div className="mt-2"><TokenList items={model.capabilities} /></div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-surface-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Provider</span>
            <span className="text-sm text-secondary">{getProviderDisplayName(model.provider)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Price</span>
            <span className="text-sm text-secondary tabular-nums">{getPriceSummary(model)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Model ID</span>
            <span className="text-xs text-muted truncate max-w-[170px]" title={model.id}>
              {model.id}
            </span>
          </div>
        </div>

        {selectable && (
          <button
            type="button"
            onClick={onSelect}
            disabled={selected}
            className={`mt-5 w-full h-9 rounded-lg text-sm font-medium transition-colors duration-fast ${
              selected
                ? "bg-surface-raised text-muted cursor-default"
                : "bg-primary text-on-emphasis hover:bg-secondary"
            }`}
          >
            {selected ? "Selected" : "Select model"}
          </button>
        )}
      </div>
    </aside>
  );
}
