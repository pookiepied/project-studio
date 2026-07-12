import { useState, useEffect, useCallback } from "react";
import {
  LockIcon as Lock,
  UsersIcon as Users,
  CpuIcon as Cpu,
  DatabaseIcon as Database,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { Manage, Collapse, Icon } from "@/ui/icons";
import { Badge } from "@/ui/primitives/Badge";
import { Button } from "@/ui/primitives/Button";
import { EmptyState } from "@/ui/primitives/EmptyState";
import { createHeaders } from "@/lib/api";
import { apiManager } from "@/core/network/apiManager";
import { useAuth } from "@/features/auth/context/AuthContext";
import { logger } from "@/core/logging/logger";
import { fetchModels } from "@/features/models/services/modelService";
import type { Model } from "@/core/models";
import type { WhitelistedUser, AdminMode, SubView, FetchState } from "../types";
import { isValidEmail } from "../helpers";
import { WhitelistView, AiModelsView, ModelRegistryView } from "../components";

export const ManagePage = () => {
  const { user: currentUser } = useAuth();

  const knownNonAdmin =
    currentUser !== null &&
    currentUser.role !== undefined &&
    currentUser.role !== "admin";

  const [subView, setSubView] = useState<SubView>(null);

  // ── Whitelist state ───────────────────────────────────────────────────────
  const [wlState, setWlState] = useState<FetchState>("idle");
  const [users, setUsers] = useState<WhitelistedUser[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [addError, setAddError] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ── AI Modes state ────────────────────────────────────────────────────────
  const [amState, setAmState] = useState<FetchState>("idle");
  const [adminModes, setAdminModes] = useState<AdminMode[]>([]);
  const [isAmRefreshing, setIsAmRefreshing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [autoRouterMode, setAutoRouterMode] = useState<"static" | "dynamic">("static");
  const [autoStaticModel, setAutoStaticModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [amSaveState, setAmSaveState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [amSaveError, setAmSaveError] = useState<string | null>(null);

  // ── Whitelist fetch ───────────────────────────────────────────────────────
  const fetchWhitelist = useCallback(async (silent = false) => {
    if (knownNonAdmin) return;
    if (!silent) setWlState("loading");
    else setIsRefreshing(true);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(`${endpoints.auth}/admin/whitelist`, { headers });
      if (res.status === 401 || res.status === 403) { setWlState("error"); return; }
      if (!res.ok) { logger.error("ManagePage", "Whitelist fetch failed", res.status); setWlState("error"); return; }
      const data = (await res.json()) as { users: WhitelistedUser[] };
      const sorted = [...(data.users ?? [])].sort((a, b) => {
        if (a.email === currentUser?.email) return -1;
        if (b.email === currentUser?.email) return 1;
        return a.email.localeCompare(b.email);
      });
      setUsers(sorted);
      setWlState("ready");
    } catch (err) {
      logger.error("ManagePage", "Fetch error", err);
      setWlState("error");
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUser?.email, knownNonAdmin]);

  // ── AI Modes fetch ────────────────────────────────────────────────────────
  const applyModes = (modes: AdminMode[]) => {
    setAdminModes(modes);
    setEditValues(Object.fromEntries(modes.filter(m => m.id !== "auto").map(m => [m.id, m.modelId])));
    const am = modes.find(m => m.id === "auto");
    if (am) {
      setAutoRouterMode(am.autoRouterMode ?? "static");
      setAutoStaticModel(am.autoStaticModel ?? am.autoDefaultStaticModel ?? "");
    }
    try { localStorage.removeItem("studio:modes"); } catch { /* ignore */ }
  };

  const fetchAdminModes = useCallback(async (silent = false) => {
    if (knownNonAdmin) return;
    if (!silent) setAmState("loading");
    else setIsAmRefreshing(true);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(endpoints.adminModes, { headers });
      if (res.status === 401 || res.status === 403) { setAmState("error"); return; }
      if (!res.ok) { logger.error("ManagePage", "Admin modes fetch failed", res.status); setAmState("error"); return; }
      const data = (await res.json()) as { data: AdminMode[] };
      applyModes(data.data ?? []);
      setAmState("ready");
    } catch (err) {
      logger.error("ManagePage", "Admin modes fetch error", err);
      setAmState("error");
    } finally {
      setIsAmRefreshing(false);
    }
  }, [knownNonAdmin]);

  // ── Sub-view entry effects ────────────────────────────────────────────────
  useEffect(() => {
    if (subView === "whitelist" && wlState === "idle") fetchWhitelist();
  }, [subView, wlState, fetchWhitelist]);

  useEffect(() => {
    if (subView !== "aimodels") return;
    if (amState === "idle") fetchAdminModes();
    if (availableModels.length === 0) {
      fetchModels(false, false)
        .then(r => setAvailableModels(r.data?.models ?? []))
        .catch(() => {});
    }
  }, [subView, amState, fetchAdminModes, availableModels.length]);

  // ── Whitelist actions ─────────────────────────────────────────────────────
  const handleAdd = async () => {
    const email = addEmail.trim().toLowerCase();
    if (!isValidEmail(email)) { setAddError("Enter a valid email address."); return; }
    if (users.some(u => u.email === email)) { setAddError("Already whitelisted."); return; }
    setAddState("loading"); setAddError(null);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(`${endpoints.auth}/admin/whitelist`, {
        method: "POST", headers, body: JSON.stringify({ email }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? `HTTP ${res.status}`); }
      setAddState("success"); setAddEmail("");
      setTimeout(() => setAddState("idle"), 2000);
      await fetchWhitelist(true);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Failed to add user.");
      setAddState("error");
      setTimeout(() => setAddState("idle"), 3000);
    }
  };

  const handleRemove = async (email: string) => {
    setRemovingEmail(email); setRemoveError(null);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(`${endpoints.auth}/admin/whitelist`, {
        method: "DELETE", headers, body: JSON.stringify({ email }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? `HTTP ${res.status}`); }
      setUsers(prev => prev.filter(u => u.email !== email));
    } catch (err: unknown) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove user.");
      setTimeout(() => setRemoveError(null), 4000);
    } finally {
      setRemovingEmail(null);
    }
  };

  // ── AI Modes dirty detection ──────────────────────────────────────────────
  const loadedAuto = adminModes.find(m => m.id === "auto");
  const isTierDirty = adminModes.some(
    m => m.id !== "auto" && (editValues[m.id] ?? m.modelId) !== m.modelId
  );
  const isAutoDirty = loadedAuto
    ? autoRouterMode !== (loadedAuto.autoRouterMode ?? "static") ||
      (autoRouterMode === "static" && autoStaticModel !== (loadedAuto.autoStaticModel ?? ""))
    : false;
  const isDirty = isTierDirty || isAutoDirty;

  // ── AI Modes save / reset ─────────────────────────────────────────────────
  const handleAmSave = async () => {
    if (!isDirty) return;
    const updates: Record<string, Record<string, unknown>> = {};
    for (const m of adminModes) {
      if (m.id === "auto") continue;
      const val = (editValues[m.id] ?? m.modelId).trim();
      if (val && val !== m.modelId) updates[m.id] = { modelId: val };
    }
    if (isAutoDirty) {
      updates["auto"] = {
        routerMode: autoRouterMode,
        ...(autoRouterMode === "static" ? { staticModel: autoStaticModel } : {}),
      };
    }
    setAmSaveState("loading"); setAmSaveError(null);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(endpoints.adminModes, {
        method: "PUT", headers, body: JSON.stringify({ updates }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? `HTTP ${res.status}`); }
      applyModes(((await res.json()) as { data: AdminMode[] }).data ?? []);
      setAmSaveState("success");
      setTimeout(() => setAmSaveState("idle"), 2000);
    } catch (err: unknown) {
      setAmSaveError(err instanceof Error ? err.message : "Failed to save.");
      setAmSaveState("error");
      setTimeout(() => { setAmSaveState("idle"); setAmSaveError(null); }, 3000);
    }
  };

  const handleAmReset = async (modeId: string) => {
    setAmSaveState("loading"); setAmSaveError(null);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(endpoints.adminModes, {
        method: "PUT", headers, body: JSON.stringify({ updates: { [modeId]: { reset: true } } }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; throw new Error(d.error ?? `HTTP ${res.status}`); }
      applyModes(((await res.json()) as { data: AdminMode[] }).data ?? []);
      setAmSaveState("success");
      setTimeout(() => setAmSaveState("idle"), 2000);
    } catch (err: unknown) {
      setAmSaveError(err instanceof Error ? err.message : "Failed to reset.");
      setAmSaveState("error");
      setTimeout(() => { setAmSaveState("idle"); setAmSaveError(null); }, 3000);
    }
  };

  const baseClass = "h-full flex flex-col bg-surface-page overflow-hidden transition-colors duration-normal";

  if (knownNonAdmin) {
    return (
      <div className={baseClass}>
        <div className="flex-shrink-0 px-5 py-3 border-b border-surface-border flex items-center gap-2">
          <Manage size="md" className="text-muted" />
          <span className="text-xl font-display font-normal text-primary">Manage</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={Lock}
            title="Admin access required"
            size="sm"
            body={
              <>
                Update your user entry with{" "}
                <code className="bg-surface-raised px-1 py-0.5 rounded text-2xs font-mono">"role": "admin"</code>
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <AnimatePresence mode="wait" initial={false}>

        {subView === null && (
          <motion.div
            key="index"
            className="h-full flex flex-col"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="flex-shrink-0 px-5 py-3 border-b border-surface-border flex items-center gap-2">
              <Manage size="md" className="text-muted" />
              <span className="text-xl font-display font-normal text-primary">Manage</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="divide-y divide-surface-divider">
                <Button
                  variant="ghost"
                  onClick={() => setSubView("whitelist")}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover text-left justify-start h-auto rounded-none"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
                    <Icon icon={Users} size="sm" className="text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-secondary">Whitelist</p>
                    <p className="text-2xs text-muted mt-0.5">Control who can sign in</p>
                  </div>
                  {wlState === "ready" && (
                    <Badge tone="default" size="sm">{users.length}</Badge>
                  )}
                  <Collapse size="xs" className="text-muted flex-shrink-0" />
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => setSubView("aimodels")}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover text-left justify-start h-auto rounded-none"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
                    <Icon icon={Cpu} size="sm" className="text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-secondary">AI Modes</p>
                    <p className="text-2xs text-muted mt-0.5">Configure tier models</p>
                  </div>
                  {amState === "ready" && adminModes.some(m => m.isCustomized) && (
                    <Badge tone="default" size="sm">
                      {adminModes.filter(m => m.isCustomized).length} custom
                    </Badge>
                  )}
                  <Collapse size="xs" className="text-muted flex-shrink-0" />
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => setSubView("modelRegistry")}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover text-left justify-start h-auto rounded-none"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
                    <Icon icon={Database} size="sm" className="text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-secondary">Model Registry</p>
                    <p className="text-2xs text-muted mt-0.5">Curated model catalogue and pricing</p>
                  </div>
                  <Collapse size="xs" className="text-muted flex-shrink-0" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {subView === "whitelist" && (
          <WhitelistView
            key="whitelist"
            wlState={wlState}
            users={users}
            currentUserEmail={currentUser?.email}
            isRefreshing={isRefreshing}
            addEmail={addEmail}
            setAddEmail={setAddEmail}
            addState={addState}
            addError={addError}
            setAddError={setAddError}
            removingEmail={removingEmail}
            removeError={removeError}
            onBack={() => setSubView(null)}
            onRefresh={() => fetchWhitelist(true)}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onRetry={() => { setWlState("idle"); fetchWhitelist(); }}
          />
        )}

        {subView === "aimodels" && (
          <AiModelsView
            key="aimodels"
            amState={amState}
            adminModes={adminModes}
            isAmRefreshing={isAmRefreshing}
            editValues={editValues}
            setEditValues={setEditValues}
            autoRouterMode={autoRouterMode}
            setAutoRouterMode={setAutoRouterMode}
            autoStaticModel={autoStaticModel}
            setAutoStaticModel={setAutoStaticModel}
            availableModels={availableModels}
            amSaveState={amSaveState}
            amSaveError={amSaveError}
            isDirty={isDirty}
            isAutoDirty={isAutoDirty}
            loadedAuto={loadedAuto}
            onBack={() => setSubView(null)}
            onRefresh={() => fetchAdminModes(true)}
            onSave={handleAmSave}
            onReset={handleAmReset}
            onRetry={() => { setAmState("idle"); fetchAdminModes(); }}
          />
        )}

        {subView === "modelRegistry" && (
          <ModelRegistryView
            key="modelRegistry"
            onBack={() => setSubView(null)}
          />
        )}

      </AnimatePresence>
    </div>
  );
};
