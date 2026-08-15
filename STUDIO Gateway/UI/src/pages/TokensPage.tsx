import { useEffect, useState } from "react";
import { gatewayApi, type GatewayKey, type NewGatewayKey } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, Eyebrow, LoadingLine, SectionHeading, Surface } from "../components/ui";

export function TokensPage() {
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<NewGatewayKey | null>(null);

  async function load() {
    setLoading(true); setError("");
    try { setKeys((await gatewayApi.keys()).data); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load API tokens"); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(key: GatewayKey) {
    try { await gatewayApi.updateKey(key.id, { enabled: key.enabled !== 1 }); setKeys((current) => current.map((item) => item.id === key.id ? { ...item, enabled: key.enabled ? 0 : 1 } : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Token status could not be updated"); }
  }
  async function rotate(key: GatewayKey) {
    try { setNewKey(await gatewayApi.rotateKey(key.id)); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Token could not be rotated"); }
  }
  async function remove(key: GatewayKey) {
    if (!window.confirm(`Delete the token “${key.name}”? Existing clients will stop working.`)) return;
    try { await gatewayApi.deleteKey(key.id); setKeys((current) => current.filter((item) => item.id !== key.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Token could not be deleted"); }
  }

  return <div className="page-frame"><SectionHeading eyebrow="CONFIGURE / ACCESS" title="API tokens" detail="Issue attributable credentials for employees, applications, and internal services." action={<><button type="button" className="secondary-button" onClick={() => void load()}><Icon name="arrowClockwise" size={15} /> Refresh</button><button type="button" className="primary-button" onClick={() => setShowCreate(true)}><Icon name="plus" size={15} /> Create token</button></>} />{error && <ErrorState message={error} onRetry={() => void load()} />}<div className="token-callout"><span className="token-callout-icon"><Icon name="shield" size={19} /></span><div><strong>Tokens are shown once.</strong><p>The gateway stores only a SHA-256 hash. Name tokens by the person or application that owns them so request analytics stay useful.</p></div></div>{loading ? <Surface><LoadingLine /></Surface> : keys.length ? <Surface className="keys-surface"><div className="surface-heading"><div><Eyebrow>ACTIVE CREDENTIALS</Eyebrow><h2>Issued tokens</h2></div><span className="surface-meta">{keys.filter((key) => key.enabled).length} enabled</span></div><div className="keys-list">{keys.map((key) => <KeyRow key={key.id} item={key} onToggle={() => void toggle(key)} onRotate={() => void rotate(key)} onDelete={() => void remove(key)} />)}</div></Surface> : <Surface><EmptyState icon="key" title="No API tokens yet" detail="Create the first token to attribute gateway usage to a person or application." action={<button type="button" className="primary-button" onClick={() => setShowCreate(true)}><Icon name="plus" size={15} /> Create token</button>} /></Surface>}{showCreate && <CreateKeyDialog onClose={() => setShowCreate(false)} onCreated={(created) => { setShowCreate(false); setNewKey(created); void load(); }} />}{newKey && <RevealKeyDialog created={newKey} onClose={() => setNewKey(null)} />}</div>;
}

function KeyRow({ item, onToggle, onRotate, onDelete }: { item: GatewayKey; onToggle: () => void; onRotate: () => void; onDelete: () => void }) {
  return <div className="key-row"><span className="key-icon"><Icon name="key" size={17} /></span><div className="key-main"><strong>{item.name}</strong><span>{item.description || "No description"}</span></div><div className="key-prefix"><code>{item.key_prefix}••••••••</code><span>Created {formatDate(item.created_at)}</span></div><div className="key-usage"><strong>{formatNumber(item.rate_limit_rpm)} rpm</strong><span>Last used {formatDate(item.last_used_at)}</span></div><span className={`enabled-label ${item.enabled ? "" : "disabled"}`}><span className="status-dot status-healthy" />{item.enabled ? "Enabled" : "Disabled"}</span><button type="button" className="icon-button subtle" aria-label="Token actions" onClick={onRotate}><Icon name="arrowClockwise" size={15} /></button><button type="button" className="icon-button subtle" aria-label={item.enabled ? "Disable token" : "Enable token"} onClick={onToggle}><Icon name={item.enabled ? "pause" : "play"} size={15} /></button><button type="button" className="icon-button subtle danger-icon" aria-label="Delete token" onClick={onDelete}><Icon name="trash" size={15} /></button></div>;
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: NewGatewayKey) => void }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [rpm, setRpm] = useState("60"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { onCreated(await gatewayApi.createKey({ name, description, rateLimitRpm: Number(rpm) })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Token could not be created"); setBusy(false); } }
  return <Dialog title="Create API token" onClose={onClose}><form className="dialog-form" onSubmit={submit}><p className="dialog-intro">Create an attributable credential for a person, product, or internal service.</p><label>Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Studio desktop" required /></label><label>Description <span className="optional">Optional</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who or what will use this token?" rows={3} /></label><label>Rate limit <span className="optional">Requests per minute</span><input type="number" min="1" max="100000" value={rpm} onChange={(event) => setRpm(event.target.value)} /></label>{error && <p className="form-error"><Icon name="warning" size={14} />{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Creating" : "Create token"}</button></div></form></Dialog>;
}

function RevealKeyDialog({ created, onClose }: { created: NewGatewayKey; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard.writeText(created.key); setCopied(true); }
  return <Dialog title="Token created" onClose={onClose}><div className="reveal-dialog"><div className="reveal-warning"><Icon name="warning" size={17} /><span>Copy this token now. It cannot be retrieved again.</span></div><code className="secret-key">{created.key}</code><button type="button" className="primary-button full-button" onClick={() => void copy()}><Icon name="copy" size={15} />{copied ? "Copied to clipboard" : "Copy token"}</button><button type="button" className="text-button centered-button" onClick={onClose}>I have stored it securely</button></div></Dialog>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog"><div className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>{children}</div></div>; }
