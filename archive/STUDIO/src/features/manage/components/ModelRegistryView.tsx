import { useEffect, useMemo, useState } from "react";
import {
  BrainIcon as Brain,
  CurrencyDollarIcon as CurrencyDollar,
  DatabaseIcon as Database,
  EyeIcon as Eye,
  FloppyDiskIcon as FloppyDisk,
  FunctionIcon as FunctionGlyph,
  ImageIcon as Image,
  PlusIcon as Plus,
  SpeakerHighIcon as SpeakerHigh,
  TrashIcon as Trash,
  VideoCameraIcon as VideoCamera,
  WaveformIcon as Waveform,
} from "@/ui/icons";
import { motion, AnimatePresence } from "framer-motion";
import { Back, Refresh, Success, Warning, Icon } from "@/ui/icons";
import { Badge } from "@/ui/primitives/Badge";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Input } from "@/ui/primitives/Input";
import { Select } from "@/ui/primitives/Select";
import { Spinner } from "@/ui/primitives/Spinner";
import { Toggle } from "@/ui/primitives/Toggle";
import { InlineToast } from "@/ui/feedback/InlineToast";
import { ProviderIcon } from "@/features/models/components/ProviderIcon";
import { categoryLabel, formatNumber, formatPricing, modelSearchText } from "../modelRegistry/formatters";
import { deleteRegistryModel, loadRegistryModels, loadRegistrySchema, saveRegistryModel, updateRegistryModel } from "../modelRegistry/service";
import type { RegistryCategory, RegistryManagementSchema, RegistryModel, RegistryPricingUnit } from "../modelRegistry/types";

interface Props {
  onBack: () => void;
}

type LoadState = "loading" | "ready" | "error";

const EMPTY_SCHEMA: RegistryManagementSchema = {
  modelTypes: ["text.chat"],
  statuses: ["active"],
  capabilities: ["chat"],
  pricing: {
    kinds: ["token"],
    statuses: ["unknown"],
    units: ["one_million_tokens"]
  },
  reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"]
};

export const ModelRegistryView = ({ onBack }: Props) => {
  const [state, setState] = useState<LoadState>("loading");
  const [models, setModels] = useState<RegistryModel[]>([]);
  const [schema, setSchema] = useState<RegistryManagementSchema>(EMPTY_SCHEMA);
  const [source, setSource] = useState<"live" | "snapshot">("snapshot");
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RegistryModel | null>(null);
  const [draftSourceId, setDraftSourceId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  const refresh = async () => {
    setState("loading");
    try {
      const [registryResult, schemaResult] = await Promise.all([loadRegistryModels(), loadRegistrySchema()]);
      setModels(registryResult.models);
      setSchema(schemaResult);
      setSource(registryResult.source);
      setSelectedId((current) => current ?? registryResult.models[0]?.id ?? null);
      setDraft(null);
      setDraftSourceId(null);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const providers = useMemo(() => Array.from(new Set(models.map((model) => model.provider))).sort(), [models]);
  const categories = useMemo(() => Array.from(new Set(models.map((model) => model.registry.category))).sort(), [models]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return models.filter((model) => {
      if (provider !== "all" && model.provider !== provider) return false;
      if (category !== "all" && model.registry.category !== category) return false;
      return !normalized || modelSearchText(model).includes(normalized);
    });
  }, [category, models, provider, query]);

  const counts = useMemo(() => {
    const reasoning = models.filter((model) => model.registry.reasoning?.supported || model.capabilities.chat?.reasoning.supported).length;
    const priced = models.filter((model) => model.registry.pricing.status === "verified").length;
    return { total: models.length, providers: providers.length, reasoning, priced };
  }, [models, providers.length]);

  const activeDraft = draft ?? selected ?? null;

  const startNewDraft = () => {
    const base = selected ?? models[0];
    if (!base) return;
    const clone = structuredClone(base);
    clone.id = `${clone.provider}:new-model`;
    clone.providerModelId = "new-model";
    clone.displayName = "New Model";
    clone.registry.aliases = ["new-model"];
    setDraft(clone);
    setDraftSourceId(null);
    setSelectedId(base.id);
  };

  const editSelected = () => {
    if (!selected) return;
    setDraft(structuredClone(selected));
    setDraftSourceId(selected.id);
  };

  const updateDraft = (updater: (model: RegistryModel) => void) => {
    setDraft((current) => {
      const base = structuredClone(current ?? selected);
      if (!base) return current;
      updater(base);
      return base;
    });
  };

  const saveDraft = async () => {
    if (!activeDraft) return;
    setSaveState("loading");
    const result = draftSourceId ? await updateRegistryModel(activeDraft) : await saveRegistryModel(activeDraft);
    setSaveState(result.persisted ? "success" : "error");
    setSaveMessage(result.message);
    if (result.persisted) {
      await refresh();
    }
    window.setTimeout(() => setSaveState("idle"), 2500);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`Delete ${selected.displayName ?? selected.id} from the active model registry?`);
    if (!confirmed) return;
    setSaveState("loading");
    const result = await deleteRegistryModel(selected.id);
    setSaveState(result.deleted ? "success" : "error");
    setSaveMessage(result.message);
    if (result.deleted) {
      setSelectedId(null);
      setDraft(null);
      setDraftSourceId(null);
      await refresh();
    }
    window.setTimeout(() => setSaveState("idle"), 2500);
  };

  return (
    <motion.div
      key="model-registry"
      className="h-full flex flex-col"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div className="flex-shrink-0 px-4 py-3 border-b border-surface-border flex items-center gap-2">
        <IconButton variant="ghost" size="sm" aria-label="Back to Manage" onClick={onBack}>
          <Back size="sm" />
        </IconButton>
        <span className="text-sm font-semibold text-primary font-sans">Model Registry</span>
        <Badge tone={source === "live" ? "strong" : "default"} size="sm">{source}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={startNewDraft} leftIcon={<Icon icon={Plus} size="xs" />}>
            New
          </Button>
          <IconButton variant="ghost" size="sm" aria-label="Refresh registry" onClick={refresh}>
            <Refresh size="xs" className={state === "loading" ? "animate-spin" : ""} />
          </IconButton>
        </div>
      </div>

      {state === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" className="text-muted" />
        </div>
      )}

      {state === "error" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Warning size="md" weight="fill" className="mx-auto text-primary" />
            <p className="text-xs text-secondary">Failed to load registry.</p>
            <Button variant="ghost" onClick={refresh} className="text-xs text-muted underline h-auto px-0 py-0 hover:bg-transparent hover:text-primary">
              Try again
            </Button>
          </div>
        </div>
      )}

      {state === "ready" && (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(300px,420px)_1fr] border-t border-surface-divider">
          <div className="min-h-0 border-r border-surface-border flex flex-col">
            <div className="p-4 space-y-3 border-b border-surface-divider">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Models" value={counts.total} />
                <Stat label="Providers" value={counts.providers} />
                <Stat label="Think" value={counts.reasoning} />
                <Stat label="Priced" value={counts.priced} />
              </div>
              <Input size="sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search registry" />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={provider}
                  onChange={setProvider}
                  options={[{ value: "all", label: "All providers" }, ...providers.map((value) => ({ value, label: value }))]}
                />
                <Select
                  value={category}
                  onChange={setCategory}
                  options={[{ value: "all", label: "All types" }, ...categories.map((value) => ({ value, label: categoryLabel(value) }))]}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-surface-divider">
              {filtered.map((model) => (
                <Button
                  key={model.id}
                  variant="ghost"
                  onClick={() => { setSelectedId(model.id); setDraft(null); }}
                  className={`w-full px-4 py-3 text-left justify-start h-auto rounded-none hover:bg-surface-hover ${
                    selected?.id === model.id && !draft ? "bg-surface-selected" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider={model.provider} modelId={model.id} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{model.displayName ?? model.id}</p>
                      <p className="text-2xs text-muted font-mono truncate">{model.providerModelId}</p>
                    </div>
                    <ModelTypeIcon category={model.registry.category} />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Badge tone="outline" size="sm">{categoryLabel(model.registry.category)}</Badge>
                    <Badge tone={model.registry.reasoning?.supported ? "strong" : "muted"} size="sm">
                      {model.registry.reasoning?.supported ? "reasoning" : "no reasoning"}
                    </Badge>
                    <Badge tone={model.registry.pricing.status === "verified" ? "strong" : "default"} size="sm">
                      {model.registry.pricing.status.replace("_", " ")}
                    </Badge>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {activeDraft && (
              <div className="p-5 max-w-5xl">
                <div className="flex items-start gap-3 mb-5">
                  <ProviderIcon provider={activeDraft.provider} modelId={activeDraft.id} size="md" />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-display font-normal text-primary truncate">{activeDraft.displayName ?? activeDraft.id}</h2>
                    <p className="text-xs text-muted font-mono truncate">{activeDraft.id}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={editSelected} leftIcon={<Icon icon={Database} size="xs" />}>
                    Edit
                  </Button>
                  {!draft && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={deleteSelected}
                      loading={saveState === "loading"}
                      leftIcon={<Icon icon={Trash} size="xs" />}
                    >
                      Delete
                    </Button>
                  )}
                  {draft && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={saveDraft}
                      loading={saveState === "loading"}
                      leftIcon={saveState === "success" ? <Success size="xs" /> : <Icon icon={FloppyDisk} size="xs" />}
                    >
                      {draftSourceId ? "Update" : "Save"}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 mb-5">
                  <Detail label="Pricing" value={formatPricing(activeDraft.registry.pricing)} />
                  <Detail label="Context" value={formatNumber(activeDraft.contextWindow)} />
                  <Detail label="Max output" value={formatNumber(activeDraft.maxTokens)} />
                </div>

                <div className="grid grid-cols-[1.1fr_0.9fr] gap-4">
                  <section className="rounded-lg border border-surface-border bg-surface-base">
                    <SectionTitle icon={<Icon icon={Database} size="sm" />} label="Identity" />
                    <div className="p-4 grid grid-cols-2 gap-3">
                      <EditorInput label="Gateway ID" value={activeDraft.id} disabled={!draft || Boolean(draftSourceId)} onChange={(value) => updateDraft((model) => { model.id = value; })} />
                      <EditorInput label="Provider model ID" value={activeDraft.providerModelId} disabled={!draft} onChange={(value) => updateDraft((model) => { model.providerModelId = value; })} />
                      <EditorInput label="Display name" value={activeDraft.displayName ?? ""} disabled={!draft} onChange={(value) => updateDraft((model) => { model.displayName = value; })} />
                      <EditorSelect
                        label="Model type"
                        value={activeDraft.registry.category}
                        disabled={!draft}
                        options={schema.modelTypes}
                        onChange={(value) => updateDraft((model) => { model.registry.category = value as RegistryCategory; })}
                      />
                      <EditorInput label="Developer" value={activeDraft.registry.developer} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.developer = value; })} />
                      <EditorInput label="Family" value={activeDraft.registry.family} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.family = value; })} />
                    </div>
                  </section>

                  <section className="rounded-lg border border-surface-border bg-surface-base">
                    <SectionTitle icon={<Icon icon={Brain} size="sm" />} label="Reasoning" />
                    <div className="p-4 space-y-3">
                      <ToggleRow label="Thinking" checked={Boolean(activeDraft.registry.reasoning?.supported)} disabled={!draft} onChange={(checked) => updateDraft((model) => {
                        const current = model.registry.reasoning;
                        model.registry.reasoning = {
                          supported: checked,
                          alwaysOn: checked && !(current?.effortValues ?? []).includes("none"),
                          canDisable: (current?.effortValues ?? []).includes("none"),
                          effortValues: checked ? current?.effortValues?.length ? current.effortValues : ["low", "medium", "high"] : [],
                          returnsReasoningContent: current?.returnsReasoningContent ?? "unknown",
                          reasoningTokensVisible: current?.reasoningTokensVisible ?? "unknown",
                          reasoningTokensBillable: current?.reasoningTokensBillable ?? "unknown",
                          worksWithTools: current?.worksWithTools ?? "unknown",
                          worksWhileStreaming: current?.worksWhileStreaming ?? "unknown",
                          requiresReasoningStateAfterTools: current?.requiresReasoningStateAfterTools ?? "unknown",
                          reducesOutputBudget: current?.reducesOutputBudget ?? "unknown",
                          providerSpecificControls: current?.providerSpecificControls ?? ["reasoning_effort"]
                        };
                        if (model.capabilities.chat) {
                          model.capabilities.chat.reasoning.supported = checked;
                          model.capabilities.chat.reasoning.efforts = model.registry.reasoning.effortValues;
                        }
                      })} />
                      <div>
                        <p className="text-2xs text-muted mb-1.5">Reasoning tiers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {schema.reasoningEfforts.map((effort) => {
                            const active = activeDraft.registry.reasoning?.effortValues.includes(effort) ?? false;
                            return (
                              <Button
                                key={effort}
                                variant="ghost"
                                disabled={!draft}
                                onClick={() => updateDraft((model) => {
                                  const reasoning = model.registry.reasoning;
                                  if (!reasoning) return;
                                  reasoning.effortValues = active
                                    ? reasoning.effortValues.filter((item) => item !== effort)
                                    : [...reasoning.effortValues, effort];
                                  reasoning.canDisable = reasoning.effortValues.includes("none");
                                  if (model.capabilities.chat) model.capabilities.chat.reasoning.efforts = reasoning.effortValues;
                                })}
                                className={`rounded-md border px-2 py-1 text-2xs h-auto disabled:opacity-50 ${
                                  active ? "border-primary bg-surface-selected text-primary" : "border-surface-border text-muted hover:bg-surface-hover"
                                }`}
                              >
                                {effort}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-surface-border bg-surface-base">
                    <SectionTitle icon={<Icon icon={CurrencyDollar} size="sm" />} label="Pricing" />
                    <div className="p-4 grid grid-cols-2 gap-3">
                      <EditorSelect label="Pricing kind" value={activeDraft.registry.pricing.kind} disabled={!draft} options={schema.pricing.kinds} onChange={(value) => updateDraft((model) => { model.registry.pricing.kind = value as typeof model.registry.pricing.kind; })} />
                      <EditorSelect label="Status" value={activeDraft.registry.pricing.status} disabled={!draft} options={schema.pricing.statuses} onChange={(value) => updateDraft((model) => { model.registry.pricing.status = value as typeof model.registry.pricing.status; })} />
                      <EditorSelect label="Unit" value={activeDraft.registry.pricing.billingUnit} disabled={!draft} options={schema.pricing.units} onChange={(value) => updateDraft((model) => { model.registry.pricing.billingUnit = value as RegistryPricingUnit; })} />
                      <EditorInput label="Native price" value={stringifyNumber(activeDraft.registry.pricing.price)} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.pricing.price = nullableNumber(value); })} />
                      <EditorInput label="Input / 1M" value={stringifyNumber(activeDraft.registry.pricing.inputPerMillion)} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.pricing.inputPerMillion = nullableNumber(value); })} />
                      <EditorInput label="Output / 1M" value={stringifyNumber(activeDraft.registry.pricing.outputPerMillion)} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.pricing.outputPerMillion = nullableNumber(value); })} />
                      <EditorInput label="Cache read / 1M" value={stringifyNumber(activeDraft.registry.pricing.cachedInputPerMillion)} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.pricing.cachedInputPerMillion = nullableNumber(value); })} />
                      <EditorInput label="Cache write / 1M" value={stringifyNumber(activeDraft.registry.pricing.cacheWritePerMillion)} disabled={!draft} onChange={(value) => updateDraft((model) => { model.registry.pricing.cacheWritePerMillion = nullableNumber(value); })} />
                    </div>
                  </section>

                  <section className="rounded-lg border border-surface-border bg-surface-base">
                    <SectionTitle icon={<Icon icon={FunctionGlyph} size="sm" />} label="Capabilities" />
                    <div className="p-4 space-y-2">
                      <ToggleRow label="Vision" checked={Boolean(activeDraft.capabilities.chat?.vision)} disabled={!draft || !activeDraft.capabilities.chat} onChange={(checked) => updateDraft((model) => { if (model.capabilities.chat) model.capabilities.chat.vision = checked; })} />
                      <ToggleRow label="Tools" checked={Boolean(activeDraft.capabilities.chat?.tools)} disabled={!draft || !activeDraft.capabilities.chat} onChange={(checked) => updateDraft((model) => { if (model.capabilities.chat) model.capabilities.chat.tools = checked; })} />
                      <ToggleRow label="Parallel / multi-tool" checked={activeDraft.registry.reasoning?.worksWithTools === true} disabled={!draft} onChange={(checked) => updateDraft((model) => { if (model.registry.reasoning) model.registry.reasoning.worksWithTools = checked; })} />
                      <ToggleRow label="Structured output" checked={Boolean(activeDraft.capabilities.chat?.jsonSchema)} disabled={!draft || !activeDraft.capabilities.chat} onChange={(checked) => updateDraft((model) => { if (model.capabilities.chat) model.capabilities.chat.jsonSchema = checked; })} />
                      <ToggleRow label="Streaming" checked={Boolean(activeDraft.capabilities.chat?.streaming)} disabled={!draft || !activeDraft.capabilities.chat} onChange={(checked) => updateDraft((model) => { if (model.capabilities.chat) model.capabilities.chat.streaming = checked; })} />
                      <ToggleRow label="Prompt cache" checked={Boolean(activeDraft.capabilities.chat?.promptCaching)} disabled={!draft || !activeDraft.capabilities.chat} onChange={(checked) => updateDraft((model) => { if (model.capabilities.chat) model.capabilities.chat.promptCaching = checked; })} />
                    </div>
                  </section>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Detail label="Modalities" value={activeDraft.capabilities.modalities.join(", ")} />
                  <Detail label="Input" value={(activeDraft.inputTypes ?? []).join(", ") || "N/A"} />
                  <Detail label="Output" value={(activeDraft.outputTypes ?? []).join(", ") || "N/A"} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {saveMessage && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <InlineToast>
              {saveState === "error" ? <Warning size="xs" weight="fill" /> : <Success size="xs" />}
              {saveMessage}
            </InlineToast>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-base px-2 py-2">
      <p className="text-2xs text-muted">{label}</p>
      <p className="text-base font-semibold text-primary">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-base px-3 py-2 min-w-0">
      <p className="text-2xs text-muted">{label}</p>
      <p className="text-xs font-medium text-primary truncate">{value}</p>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="px-4 py-3 border-b border-surface-divider flex items-center gap-2 text-sm font-medium text-secondary">
      <span className="text-muted">{icon}</span>
      {label}
    </div>
  );
}

function EditorInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-2xs text-muted">{label}</span>
      <Input size="sm" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EditorSelect({ label, value, disabled, options, onChange }: { label: string; value: string; disabled: boolean; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-2xs text-muted">{label}</span>
      <Select value={value} disabled={disabled} onChange={onChange} options={options.map((option) => ({ value: option, label: option.split("_").join(" ") }))} />
    </label>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-secondary">{label}</span>
      <Toggle size="sm" checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function ModelTypeIcon({ category }: { category: string }) {
  const className = "text-muted flex-shrink-0";
  if (category.startsWith("image")) return <Icon icon={Image} size="sm" className={className} />;
  if (category.startsWith("video")) return <Icon icon={VideoCamera} size="sm" className={className} />;
  if (category === "audio.speech") return <Icon icon={SpeakerHigh} size="sm" className={className} />;
  if (category === "audio.transcription") return <Icon icon={Waveform} size="sm" className={className} />;
  if (category === "embeddings") return <Icon icon={Database} size="sm" className={className} />;
  if (category === "text.chat") return <Icon icon={Brain} size="sm" className={className} />;
  return <Icon icon={Eye} size="sm" className={className} />;
}

function stringifyNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
