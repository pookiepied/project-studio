import { ProviderIcon, getProviderDisplayName } from "@/features/models/components/ProviderIcon";
import type { Model } from "@/core/models";
import { isFreeModel } from "../../helpers";

export function ProviderRail({
  providers,
  selectedProvider,
  onSelectProvider,
}: {
  providers: [string, Model[]][];
  selectedProvider: string;
  onSelectProvider: (provider: string) => void;
}) {
  const total = providers.reduce((sum, [, models]) => sum + models.length, 0);

  return (
    <aside className="hidden lg:block border-r border-surface-border bg-surface-base overflow-y-auto scrollbar-auto-hide">
      <div className="p-2">
        <button
          type="button"
          onClick={() => onSelectProvider("all")}
          className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast ${
            selectedProvider === "all"
              ? "bg-surface-raised text-primary shadow-sm"
              : "text-secondary hover:bg-surface-hover"
          }`}
        >
          <span className="text-sm font-medium">All providers</span>
          <span className="text-2xs tabular-nums text-muted">{total}</span>
        </button>

        <div className="mt-2 space-y-0.5">
          {providers.map(([provider, models]) => {
            const active = selectedProvider === provider;
            const freeCount = models.filter(isFreeModel).length;

            return (
              <button
                key={provider}
                type="button"
                onClick={() => onSelectProvider(provider)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast ${
                  active
                    ? "bg-surface-raised text-primary shadow-sm"
                    : "text-secondary hover:bg-surface-hover"
                }`}
              >
                <ProviderIcon provider={provider} size="xs" />
                <span className="flex-1 min-w-0 text-sm truncate">
                  {getProviderDisplayName(provider)}
                </span>
                <span className="text-2xs tabular-nums text-muted">
                  {models.length}
                </span>
                {freeCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" title={`${freeCount} free`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
