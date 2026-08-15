import { useEffect, useMemo, useState } from "react";
import { gatewayApi, type CatalogModel } from "../lib/api";
import { formatCurrency, formatDate, formatNumber, humanCategory } from "../lib/format";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, Eyebrow, LoadingLine, ProviderMark, SectionHeading, Surface } from "../components/ui";

const categories = ["all", "text", "image", "embedding", "speech", "transcription", "video"];

export function ModelsPage() {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [totalModels, setTotalModels] = useState(0);
  const [production, setProduction] = useState<Set<string>>(new Set());
  const [deployed, setDeployed] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogModel | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await gatewayApi.models("limit=500&offset=0");
      setModels(result.data);
      setTotalModels(result.total);
      const exposed = new Set(result.data.filter((model) => model.exposed === 1).map(modelKey));
      setProduction(exposed);
      setDeployed(new Set(exposed));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the model catalog");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function loadMore() {
    if (loading || models.length >= totalModels) return;
    setLoading(true);
    setError("");
    try {
      const result = await gatewayApi.models(`limit=500&offset=${models.length}`);
      setModels((current) => [...current, ...result.data]);
      setTotalModels(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load more catalog models");
    } finally { setLoading(false); }
  }

  const providers = useMemo(() => ["all", ...Array.from(new Set(models.map((model) => model.provider_id))).sort()], [models]);
  const filtered = useMemo(() => models.filter((model) => {
    const matchesCategory = category === "all" || model.category === category;
    const matchesProvider = provider === "all" || model.provider_id === provider;
    const needle = search.trim().toLowerCase();
    return matchesCategory && matchesProvider && (!needle || `${model.model_id} ${model.display_name ?? ""} ${model.provider_id}`.toLowerCase().includes(needle));
  }), [models, category, provider, search]);
  const draftChanged = !setsEqual(production, deployed);

  function addToProduction(key: string) { setProduction((current) => new Set(current).add(key)); }
  function removeFromProduction(key: string) { setProduction((current) => { const next = new Set(current); next.delete(key); return next; }); }

  async function deploy() {
    setDeploying(true);
    setError("");
    const added = models.filter((model) => production.has(modelKey(model)) && !deployed.has(modelKey(model))).map((model) => ({ provider_id: model.provider_id, model_id: model.model_id }));
    const removed = models.filter((model) => !production.has(modelKey(model)) && deployed.has(modelKey(model))).map((model) => ({ provider_id: model.provider_id, model_id: model.model_id }));
    try {
      if (added.length) await gatewayApi.bulkModels(added, { exposed: true });
      if (removed.length) await gatewayApi.bulkModels(removed, { exposed: false });
      setDeployed(new Set(production));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The production model configuration could not be deployed");
    } finally { setDeploying(false); }
  }

  return <div className="page-frame">
    <SectionHeading eyebrow="CONFIGURE / MODELS" title="Model catalog" detail={`${formatNumber(models.length)} discovered models · ${formatNumber(production.size)} in production`} action={<div className="heading-actions"><button type="button" className="secondary-button" onClick={() => void load()}><Icon name="arrowClockwise" size={15} /> Sync view</button><button type="button" className="primary-button" disabled={!draftChanged || deploying} onClick={() => void deploy()}>{deploying ? <><Icon name="spinner" size={15} className="spin" /> Deploying</> : <><Icon name="upload" size={15} /> Deploy configuration</>}</button></div>} />
    <div className="deployment-note"><Icon name="shield" size={16} /><span><strong>Discovered is not production.</strong> Drag models into the production configuration, then deploy once the draft looks right.</span>{draftChanged && <span className="draft-pill">Unsaved draft</span>}</div>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <Surface className="catalog-toolbar"><label className="search-input wide"><Icon name="magnifying" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search model IDs, names, or providers" /></label><select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Filter provider">{providers.map((value) => <option key={value} value={value}>{value === "all" ? "All providers" : value}</option>)}</select><div className="category-tabs">{categories.map((value) => <button type="button" key={value} className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{value === "all" ? "All" : humanCategory(value)}</button>)}</div></Surface>
    {loading && !models.length ? <Surface><LoadingLine /></Surface> : <div className="model-workspace"><Surface className="catalog-surface"><div className="surface-heading"><div><Eyebrow>AVAILABLE CATALOG</Eyebrow><h2>Choose from discovery</h2></div><span className="surface-meta">{formatNumber(models.length)} of {formatNumber(totalModels)} loaded</span></div>{filtered.length ? <><div className="catalog-list">{filtered.map((model) => <ModelCard key={modelKey(model)} model={model} inProduction={production.has(modelKey(model))} onDragStart={() => setDragging(modelKey(model))} onDragEnd={() => setDragging(null)} onAdd={() => addToProduction(modelKey(model))} onSelect={() => setSelected(model)} />)}</div>{models.length < totalModels && <div className="catalog-more"><button type="button" className="secondary-button" disabled={loading} onClick={() => void loadMore()}>{loading ? <><Icon name="spinner" size={14} className="spin" /> Loading catalog</> : <>Load next 500 models <Icon name="arrowClockwise" size={14} /></>}</button></div>}</> : <EmptyState icon="cube" title="No models match" detail="Adjust the filters or run provider discovery to refresh the catalog." />}</Surface><Surface className={`production-surface ${dragging ? "drop-active" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragging) addToProduction(dragging); setDragging(null); }}><div className="surface-heading"><div><Eyebrow>PRODUCTION CONFIGURATION</Eyebrow><h2>Deployed models</h2></div><span className="production-count">{production.size}</span></div>{production.size ? <div className="production-list">{models.filter((model) => production.has(modelKey(model))).map((model, index) => <div className="production-card" key={modelKey(model)} draggable onDragStart={() => setDragging(modelKey(model))} onDragEnd={() => setDragging(null)}><span className="drag-dots"><Icon name="dots" size={18} /></span><span className="production-order">{String(index + 1).padStart(2, "0")}</span><ProviderMark name={model.provider_id} size="sm" /><div><strong>{model.display_name || model.model_id}</strong><span>{model.provider_id} · {humanCategory(model.category)}</span></div><button type="button" className="icon-button subtle" aria-label={`Remove ${model.model_id}`} onClick={() => removeFromProduction(modelKey(model))}><Icon name="close" size={15} /></button></div>)}</div> : <div className="drop-empty"><span className="drop-target"><Icon name="upload" size={22} /></span><strong>Drop models here</strong><span>Build the production set deliberately, then deploy it.</span></div>}<div className="production-footer"><span><span className="status-dot status-healthy" /> Live configuration</span>{draftChanged && <span className="muted">Draft differs from production</span>}</div></Surface></div>}
    {selected && <ModelDetail model={selected} onClose={() => setSelected(null)} inProduction={production.has(modelKey(selected))} onAdd={() => addToProduction(modelKey(selected))} />}
  </div>;
}

function ModelCard({ model, inProduction, onDragStart, onDragEnd, onAdd, onSelect }: { model: CatalogModel; inProduction: boolean; onDragStart: () => void; onDragEnd: () => void; onAdd: () => void; onSelect: () => void }) {
  return <article className={`model-card ${inProduction ? "in-production" : ""}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDoubleClick={onSelect}><div className="model-card-top"><ProviderMark name={model.provider_id} size="sm" /><span className="model-provider">{model.provider_id}</span><span className={`catalog-status ${model.enabled ? "enabled" : "disabled"}`}>{model.enabled ? "Available" : "Disabled"}</span></div><button type="button" className="model-name-button" onClick={onSelect}><strong>{model.display_name || model.model_id}</strong><code>{model.model_id}</code></button><div className="capability-row model-capabilities">{model.supports_vision ? <span className="capability"><Icon name="eye" size={12} />Vision</span> : null}{model.supports_tools ? <span className="capability"><Icon name="stack" size={12} />Tools</span> : null}{model.supports_reasoning ? <span className="capability"><Icon name="lightning" size={12} />Reasoning</span> : null}<span className="capability">{humanCategory(model.category)}</span></div><div className="model-card-bottom"><span>{model.context_window ? `${formatNumber(model.context_window)} context` : "Context unknown"}</span>{model.pricing_input !== null ? <span>{formatCurrency(model.pricing_input)} / M in</span> : <span>Pricing unavailable</span>}</div><button type="button" className={`model-action ${inProduction ? "selected" : ""}`} onClick={onAdd}>{inProduction ? <><Icon name="check" size={14} /> In production</> : <><Icon name="plus" size={14} /> Add to production</>}</button></article>;
}

function ModelDetail({ model, onClose, inProduction, onAdd }: { model: CatalogModel; onClose: () => void; inProduction: boolean; onAdd: () => void }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-panel model-detail-panel"><div className="detail-header"><div><Eyebrow>MODEL PROFILE</Eyebrow><h2>{model.display_name || model.model_id}</h2></div><button type="button" className="icon-button" aria-label="Close model detail" onClick={onClose}><Icon name="close" size={18} /></button></div><div className="model-detail-banner"><ProviderMark name={model.provider_id} size="lg" /><div><strong>{model.model_id}</strong><span>{model.provider_id} · {humanCategory(model.category)}</span></div></div><div className="detail-section"><h3>Capabilities</h3><div className="capability-row"><CapabilityState label="Text" enabled={model.input_modalities?.includes("text") ?? false} /><CapabilityState label="Vision" enabled={Boolean(model.supports_vision)} /><CapabilityState label="Tools" enabled={Boolean(model.supports_tools)} /><CapabilityState label="Reasoning" enabled={Boolean(model.supports_reasoning)} /></div></div><div className="detail-section"><h3>Limits and pricing</h3><div className="detail-grid"><div><span>Context window</span><strong>{model.context_window ? formatNumber(model.context_window) : "Unknown"}</strong></div><div><span>Max output</span><strong>{model.max_output_tokens ? formatNumber(model.max_output_tokens) : "Unknown"}</strong></div><div><span>Input / 1M</span><strong>{model.pricing_input === null ? "Unknown" : formatCurrency(model.pricing_input)}</strong></div><div><span>Output / 1M</span><strong>{model.pricing_output === null ? "Unknown" : formatCurrency(model.pricing_output)}</strong></div><div><span>Cache read / 1M</span><strong>{model.pricing_cache_read === null ? "Unknown" : formatCurrency(model.pricing_cache_read)}</strong></div><div><span>Catalog updated</span><strong>{formatDate(model.fetched_at)}</strong></div></div></div><div className="detail-section"><h3>Metadata</h3><div className="detail-grid"><div><span>Family</span><strong>{model.family || "Not reported"}</strong></div><div><span>Lab</span><strong>{model.lab || "Not reported"}</strong></div><div><span>Data source</span><strong>{model.catalog_source || "Unknown"}</strong></div><div><span>Knowledge cutoff</span><strong>{model.knowledge_cutoff || "Not reported"}</strong></div></div></div><button type="button" className={`primary-button full-button ${inProduction ? "secondary-action" : ""}`} onClick={onAdd}>{inProduction ? <><Icon name="check" size={15} /> In production</> : <><Icon name="plus" size={15} /> Add to production draft</>}</button></aside></div>;
}

function CapabilityState({ label, enabled }: { label: string; enabled: boolean }) { return <span className={`capability-state ${enabled ? "enabled" : ""}`}><Icon name={enabled ? "check" : "close"} size={13} />{label}</span>; }
function modelKey(model: CatalogModel): string { return `${model.provider_id}/${model.model_id}`; }
function setsEqual(a: Set<string>, b: Set<string>): boolean { return a.size === b.size && Array.from(a).every((item) => b.has(item)); }
