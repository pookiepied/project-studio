import { useEffect, useState } from "react";
import { gatewayApi, type CatalogModel, type Provider } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, Eyebrow, LoadingLine, ProviderMark, SectionHeading, StatusDot, Surface } from "../components/ui";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Provider | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try { setProviders((await gatewayApi.providers()).data); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load providers"); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function syncAll() {
    setSyncing(true); setMessage(""); setError("");
    try {
      const catalog = await gatewayApi.syncCatalog();
      const discovery = await gatewayApi.discovery();
      setMessage(`Synchronization complete${catalog.upserted ? ` · ${formatNumber(catalog.upserted)} catalog records` : ""}${discovery.discovered ? ` · ${formatNumber(discovery.discovered)} live models` : ""}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider synchronization failed"); } finally { setSyncing(false); }
  }

  async function toggle(provider: Provider) {
    try { await gatewayApi.updateProvider(provider.id, { enabled: provider.enabled !== 1 }); setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, enabled: provider.enabled ? 0 : 1 } : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider status could not be updated"); }
  }

  return <div className="page-frame">
    <SectionHeading eyebrow="CONFIGURE / PROVIDERS" title="Provider control" detail="Keep credentials, availability, and model synchronization visible without exposing secrets." action={<button type="button" className="primary-button" onClick={() => void syncAll()} disabled={syncing}><Icon name="arrowClockwise" size={15} className={syncing ? "spin" : ""} /> {syncing ? "Syncing providers" : "Sync all providers"}</button>} />
    {message && <div className="success-banner"><Icon name="check" size={16} />{message}</div>}{error && <ErrorState message={error} onRetry={() => void load()} />}
    {loading ? <Surface><LoadingLine /></Surface> : providers.length ? <div className="provider-grid">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} onToggle={() => void toggle(provider)} onOpen={() => setSelected(provider)} />)}</div> : <Surface><EmptyState icon="buildings" title="No providers configured" detail="Connect a provider to begin discovering models." /></Surface>}
    {selected && <ProviderDetail provider={selected} onClose={() => setSelected(null)} onConnected={() => { setProviders((current) => current.map((item) => item.id === selected.id ? { ...item, credential_configured: 1 } : item)); setSelected((current) => current ? { ...current, credential_configured: 1 } : current); }} onDisconnected={() => { setProviders((current) => current.map((item) => item.id === selected.id ? { ...item, credential_configured: 0 } : item)); setSelected((current) => current ? { ...current, credential_configured: 0 } : current); }} />}
  </div>;
}

function ProviderCard({ provider, onToggle, onOpen }: { provider: Provider; onToggle: () => void; onOpen: () => void }) {
  return <Surface className={`provider-card ${provider.enabled ? "" : "provider-disabled"}`}><div className="provider-card-header"><ProviderMark name={provider.id} size="lg" /><div><h2>{provider.name}</h2><span className="provider-id">{provider.id}</span></div><button type="button" className={`toggle ${provider.enabled ? "on" : ""}`} aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name}`} aria-pressed={provider.enabled === 1} onClick={onToggle}><span /></button></div><div className="provider-status"><span><StatusDot status={provider.enabled ? "healthy" : "neutral"} />{provider.enabled ? "Enabled" : "Disabled"}</span><span>{provider.auth_mode === "apiKey" ? "API key" : provider.auth_mode}</span></div><div className="provider-details"><div><span>Protocol</span><strong>{provider.protocol.replaceAll("-", " ")}</strong></div><div><span>Catalog</span><strong>{provider.catalog_source || "Manual"}</strong></div><div><span>Updated</span><strong>{formatDate(provider.updated_at)}</strong></div></div><div className="provider-card-footer"><span className="credential-state"><span className={`credential-dot ${provider.credential_configured ? "configured" : ""}`} /> {provider.credential_configured ? "Connected" : "Credential not configured"}</span><button type="button" className="text-button" onClick={onOpen}>Open profile <Icon name="arrowUpRight" size={14} /></button></div></Surface>;
}

function ProviderDetail({ provider, onClose, onConnected, onDisconnected }: { provider: Provider; onClose: () => void; onConnected: () => void; onDisconnected: () => void }) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "delete" | "sync" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setModels((await gatewayApi.provider(provider.id)).models); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load provider details"); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [provider.id]);

  async function save() {
    if (!apiKey.trim()) return;
    setBusy("save"); setError(""); setMessage("");
    try { const result = await gatewayApi.saveCredential(provider.id, apiKey); setApiKey(""); onConnected(); setMessage(`Connected securely ${result.hint}.`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Credential could not be saved"); } finally { setBusy(""); }
  }
  async function remove() {
    setBusy("delete"); setError("");
    try { await gatewayApi.deleteCredential(provider.id); onDisconnected(); setMessage("Provider credential removed."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Credential could not be removed"); } finally { setBusy(""); }
  }
  async function sync() {
    setBusy("sync"); setError(""); setMessage("");
    try { const result = await gatewayApi.syncProvider(provider.id); await load(); setMessage(`Sync complete · ${formatNumber(result.discovered)} model records${result.errors.length ? ` · ${result.errors.length} errors` : ""}.`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider synchronization failed"); } finally { setBusy(""); }
  }

  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-panel provider-detail-panel"><div className="detail-header"><div><Eyebrow>PROVIDER PROFILE</Eyebrow><h2>{provider.name}</h2></div><button type="button" className="icon-button" aria-label="Close provider detail" onClick={onClose}><Icon name="close" size={18} /></button></div><div className="provider-detail-hero"><ProviderMark name={provider.id} size="lg" /><div><strong>{provider.id}</strong><span>{provider.protocol.replaceAll("-", " ")} · {provider.base_url}</span></div><StatusDot status={provider.enabled ? "healthy" : "neutral"} /></div><div className="detail-section"><h3>Connection</h3><p className="detail-copy">The provider API key is encrypted before it is persisted. The plaintext value is never returned to this workspace.</p><label className="secret-input"><Icon name="lock" size={15} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider.credential_configured ? "Replace stored API key" : "Paste provider API key"} autoComplete="new-password" /></label><div className="connection-actions"><button type="button" className="primary-button" disabled={!apiKey.trim() || busy !== ""} onClick={() => void save()}>{busy === "save" ? <><Icon name="spinner" size={14} className="spin" /> Saving</> : <><Icon name="shield" size={14} /> {provider.credential_configured ? "Replace credential" : "Connect provider"}</>}</button>{provider.credential_configured ? <button type="button" className="text-button danger-text" disabled={busy !== ""} onClick={() => void remove()}>{busy === "delete" ? "Removing" : "Remove credential"}</button> : null}</div>{message && <p className="inline-success"><Icon name="check" size={14} />{message}</p>}{error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}</div><div className="detail-section"><div className="detail-section-heading"><h3>Discovered models</h3><button type="button" className="secondary-button" disabled={busy !== "" || !provider.enabled} onClick={() => void sync()}><Icon name="arrowClockwise" size={14} className={busy === "sync" ? "spin" : ""} /> Sync provider</button></div>{loading ? <LoadingLine /> : models.length ? <div className="provider-model-list">{models.slice(0, 30).map((model) => <div className="provider-model-row" key={`${model.provider_id}/${model.model_id}`}><span className="model-mini-status" /><div><strong>{model.display_name || model.model_id}</strong><span>{model.model_id}</span></div><span className="provider-model-category">{model.category}</span></div>)}</div> : <EmptyState icon="cube" title="No models discovered" detail="Connect the provider, then synchronize its model catalog." />}</div></aside></div>;
}
