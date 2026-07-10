import {
  EyeIcon as Eye,
  WrenchIcon as Wrench,
  HardDrivesIcon as HardDrives,
  LeafIcon as Leaf,
} from "@phosphor-icons/react";
import { Success, Icon } from "@/ui/icons";
import { ProviderIcon } from "@/features/models/components/ProviderIcon";
import type { Model } from "@/core/models";
import {
  isFreeModel, isVisionModel, hasTools, hasReasoning,
  formatCtx, formatModelPrice, getModelSubtitle,
} from "../../helpers";

export function ModelListRow({
  model,
  active,
  selected,
  autoModelId,
  onPreview,
}: {
  model: Model;
  active: boolean;
  selected: boolean;
  autoModelId: string;
  onPreview: () => void;
}) {
  const free = isFreeModel(model);
  const vision = isVisionModel(model);
  const tools = hasTools(model);
  const reasoning = hasReasoning(model);

  return (
    <button
      type="button"
      onClick={onPreview}
      className={`w-full grid grid-cols-[minmax(0,1fr)_88px_82px_72px] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-fast ${
        active ? "bg-surface-selected" : "hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <ProviderIcon provider={model.provider} modelId={model.id} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-primary truncate">
              {model.name}
            </span>
            {model.id === autoModelId && (
              <Icon icon={Leaf} size="xs" className="text-muted flex-shrink-0" />
            )}
            {selected && (
              <Success size="xs" className="text-secondary flex-shrink-0" />
            )}
          </div>
          <p className="mt-0.5 text-2xs text-muted truncate">
            {getModelSubtitle(model)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-muted">
        {vision && <span title="Vision"><Icon icon={Eye} size="xs" /></span>}
        {tools && <span title="Tools"><Icon icon={Wrench} size="xs" /></span>}
        {reasoning && <span className="text-2xs font-medium" title="Reasoning">R</span>}
        {model.provider === "local" && <span title="Local"><Icon icon={HardDrives} size="xs" /></span>}
        {free && model.provider !== "local" && (
          <span className="text-2xs font-medium text-secondary">Free</span>
        )}
      </div>

      <span className="text-xs tabular-nums text-secondary">
        {formatCtx(model.contextWindow)}
      </span>

      <span className="text-xs tabular-nums text-secondary truncate">
        {free ? "Free" : formatModelPrice(model.pricing?.input)}
      </span>
    </button>
  );
}
