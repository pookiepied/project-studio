import { useState, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { PlusIcon as Plus } from "@phosphor-icons/react";
import { Warning, Close, Search, Manage, Refresh, Expand, Icon } from "@/ui/icons";
import { IconButton } from "@/ui/primitives/IconButton";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useChat } from "@/features/chat/context";
import { environmentService } from "@/core/platform/environmentService";
import { useMcpServers, useComposio } from "../hooks";
import {
  HeroBanner,
  FeaturedCard, ComposioAppBrowseCard, FEATURED_APPS,
  Context7BrowseCard,
  AppConnectModal, type AppConnectModalConfig,
  AddServerForm,
  ManagePanel,
  Context7Icon,
} from "../components";

// ─── Main page ────────────────────────────────────────────────────────────────
export const ExtensionsPage = () => {
  const { navigateTo }       = useNavigation();
  const { isAuthenticated }  = useAuth();
  const { createNewConversation } = useChat();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [search,               setSearch]               = useState("");
  const [showManagePanel,      setShowManagePanel]      = useState(false);
  const [showCustomModal,      setShowCustomModal]      = useState(false);
  const [connectModal, setConnectModal] = useState<{
    config: AppConnectModalConfig;
    kind:   "composio" | "bundled";
    appId:  string;
  } | null>(null);
  const [connectRefMemories, setConnectRefMemories] = useState(false);

  const isTauri = environmentService.isTauri();

  // ── Data hooks ───────────────────────────────────────────────────────────────
  const mcp = useMcpServers();
  const composio = useComposio(mcp.setMcpError);

  // ── Search filter helpers ────────────────────────────────────────────────────
  const matches = (q: string, ...terms: string[]) =>
    !q.trim() || terms.some(t => t.toLowerCase().includes(q.toLowerCase()));

  const context7MatchesSearch         = matches(search, "context7 upstash", "docs library api documentation versions");

  // slice access intentional; whole-object dep would over-trigger recomputation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredApps   = useMemo(() => composio.composioFilteredApps(search), [search, composio.composioFilteredApps]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groupedApps    = useMemo(() => composio.groupedComposioApps(search),  [search, composio.groupedComposioApps]);

  const [collapsedComposioGroups, setCollapsedComposioGroups] = useState<Set<string>>(new Set());
  const toggleComposioGroup = (key: string) =>
    setCollapsedComposioGroups(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // ── Connect modal computed values ────────────────────────────────────────────
  const modalConn        = connectModal?.kind === "composio"
    ? composio.composioConnections.find(c => c.appName.toLowerCase() === connectModal.appId.toLowerCase())
    : undefined;
  const modalIsConnected = modalConn?.status === "ACTIVE";
  const modalIsPending   = !!modalConn && !modalIsConnected;
  const modalIsConnecting = connectModal?.kind === "composio" && composio.composioConnecting === connectModal?.appId;
  const modalBundledSrv  = connectModal?.kind === "bundled"
    ? mcp.mcpServers.find(s => s.name === connectModal.appId)
    : undefined;

  let modalPrimaryLabel   = "Connect";
  let modalPrimaryDisabled = false;
  let modalPrimaryNote: string | undefined;
  let modalDestructiveLabel: string | undefined;

  if (connectModal) {
    if (connectModal.kind === "composio") {
      if (modalIsPending)    { modalPrimaryLabel = "Authorizing…"; modalPrimaryDisabled = true; modalDestructiveLabel = "Cancel"; }
      else if (modalIsConnected) { modalPrimaryLabel = "Connected"; modalPrimaryDisabled = true; modalDestructiveLabel = "Disconnect"; }
      else if (!isAuthenticated) { modalPrimaryDisabled = true; modalPrimaryNote = "Sign in required"; }
    } else {
      if (!isTauri)               { modalPrimaryLabel = "Install"; modalPrimaryDisabled = true; modalPrimaryNote = "Desktop app required"; }
      else if (!isAuthenticated)  { modalPrimaryLabel = "Install"; modalPrimaryDisabled = true; modalPrimaryNote = "Sign in required"; }
      else if (modalBundledSrv)   { modalPrimaryLabel = "Installed"; modalPrimaryDisabled = true; modalDestructiveLabel = "Remove"; }
      else                        { modalPrimaryLabel = "Install"; }
    }
  }

  const handleModalPrimary = async () => {
    if (!connectModal) return;
    setConnectModal(null);
    if (connectModal.kind === "composio") {
      await composio.handleComposioConnect(connectModal.appId);
    } else {
      switch (connectModal.appId) {
        case "context7":           await mcp.handleContext7Install(); break;
      }
    }
  };

  const handleModalDestructive = async () => {
    if (!connectModal) return;
    if (connectModal.kind === "composio") {
      const conn = composio.composioConnections.find(c => c.appName.toLowerCase() === connectModal.appId.toLowerCase());
      if (conn) await composio.handleComposioDisconnect(conn.id, connectModal.appId);
    } else {
      await mcp.handleMcpUninstall(connectModal.appId);
    }
    setConnectModal(null);
  };

  // ── Bundled server modal configs ─────────────────────────────────────────────
  const bundledConfigs: Record<string, AppConnectModalConfig> = {
    "context7": {
      name: "Context7",
      logoNode: <Context7Icon size={26} className="text-secondary" />,
      description: "Pulls live, version-accurate library docs into every chat. No stale examples.",
      developer: "Upstash", category: "Knowledge",
      tosUrl: "https://upstash.com/terms", privacyUrl: "https://upstash.com/privacy",
    },
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-page transition-colors duration-normal relative">

      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-3 pb-3 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-display font-normal text-primary">Apps</h1>
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="relative">
              <Search size="xs" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-36 pl-7 pr-6 py-1.5 text-xs bg-surface-raised border border-transparent rounded-full text-secondary placeholder:text-muted transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors">
                  <Close size="xs" />
                </button>
              )}
            </div>
            <button onClick={() => setShowManagePanel(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary bg-surface-raised hover:bg-surface-hover rounded-full transition-colors duration-fast flex-shrink-0">
              <Manage size="xs" />Manage
            </button>
            <button onClick={() => { setShowCustomModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary bg-surface-raised hover:bg-surface-hover rounded-full transition-colors duration-fast flex-shrink-0">
              <Icon icon={Plus} size="xs" />Custom
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {mcp.mcpError && (
          <div className="flex items-center gap-2 mx-6 mt-3 px-3 py-2 bg-surface-raised border border-surface-border rounded-xl text-xs text-secondary">
            <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
            <span className="flex-1">{mcp.mcpError}</span>
            <button onClick={() => mcp.setMcpError(null)} aria-label="Dismiss error" className="flex-shrink-0 text-muted hover:text-primary transition-colors">
              <Close size="xs" />
            </button>
          </div>
        )}
      </AnimatePresence>

      {/* Main scroll area */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-4 sm:px-6 py-5">
        <div className="space-y-5 max-w-2xl mx-auto">

          {/* Hero */}
          {!search.trim() && (
            <HeroBanner onTryInChat={() => { createNewConversation(); navigateTo("chat"); }} composioApps={composio.composioApps} />
          )}

          {/* Featured */}
          {!search.trim() && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted tracking-wider uppercase px-0.5">Featured</p>
              <div className="grid grid-cols-2 gap-2.5">
                {FEATURED_APPS.map(app => {
                  const isInstalled = app.kind === "bundled"
                    ? !!mcp.mcpServers.find(s => s.name === app.id)
                    : !!composio.composioConnections.find(c => c.appName.toLowerCase() === app.id.toLowerCase() && c.status === "ACTIVE");
                  const composioAppData = app.kind === "composio"
                    ? composio.composioApps.find(a => a.appId.toLowerCase() === app.id.toLowerCase())
                    : undefined;
                  return (
                    <FeaturedCard
                      key={app.id}
                      app={app}
                      isInstalled={isInstalled}
                      logo={composioAppData?.logo}
                      onClick={() => {
                        if (app.kind === "composio") {
                          const composioApp = composio.composioApps.find(a => a.appId.toLowerCase() === app.id.toLowerCase());
                          setConnectModal({
                            config: {
                              name: app.name,
                              logo: composioApp?.logo,
                              description: composioApp?.description ?? `Connect ${app.name} to your AI assistant.`,
                              developer: "Composio · Official",
                            },
                            kind: "composio",
                            appId: app.id,
                          });
                        } else if (bundledConfigs[app.id]) {
                          setConnectModal({ config: bundledConfigs[app.id], kind: "bundled", appId: app.id });
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Composio app grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-end">
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Refresh app logos"
                title="Refresh app logos"
                onClick={composio.handleRefreshComposioLogos}
                disabled={composio.composioCacheRefreshing}
              >
                <Refresh size="xs" className={composio.composioCacheRefreshing ? "animate-spin" : ""} />
              </IconButton>
            </div>
            {composio.composioAppsLoading ? (
              <p className="text-xs text-muted text-center py-4">Loading apps…</p>
            ) : filteredApps.length === 0 ? (
              <p className="text-xs text-muted text-center py-4">No apps found</p>
            ) : (
              <div className="space-y-4">
                {groupedApps.map(([category, apps]) => (
                  <div key={category} className="space-y-2">
                    <button onClick={() => toggleComposioGroup(`browse:${category}`)} className="flex items-center gap-1.5 w-full">
                      <p className="text-2xs font-semibold text-muted tracking-wider uppercase px-0.5">{category}</p>
                      <Expand size="xs" className={`text-muted transition-transform duration-150 ${collapsedComposioGroups.has(`browse:${category}`) ? "-rotate-90" : ""}`} />
                      <span className="ml-auto text-2xs text-muted">{apps.length}</span>
                    </button>
                    {!collapsedComposioGroups.has(`browse:${category}`) && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {apps.map(app => {
                          const conn = composio.composioConnections.find(c => c.appName.toLowerCase() === app.appId.toLowerCase());
                          return (
                            <ComposioAppBrowseCard
                              key={app.appId} app={app} connected={conn}
                              polling={composio.composioPolling.has(app.appId.toLowerCase())}
                              onToggle={conn ? () => composio.handleComposioToggle(conn.id, !conn.enabled) : undefined}
                              onClick={() => setConnectModal({
                                config: {
                                  name: app.name, logo: app.logo,
                                  description: app.description ?? `Connect ${app.name} to your AI assistant.`,
                                  developer: "Composio · Official", category: app.curatedCategory,
                                },
                                kind: "composio", appId: app.appId,
                              })}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Knowledge */}
          {context7MatchesSearch && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted tracking-wider uppercase px-0.5">Knowledge</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Context7BrowseCard
                  installed={!!mcp.context7Server} server={mcp.context7Server}
                  isRunning={mcp.context7Running} isTauri={isTauri}
                  onStart={() => mcp.context7Server && mcp.handleMcpStart(mcp.context7Server)}
                  onStop={() => mcp.handleMcpStop("context7")}
                  onToggle={() => mcp.context7Server && mcp.handleMcpToggle("context7", !mcp.context7Server.enabled)}
                  onClick={() => setConnectModal({ config: bundledConfigs["context7"], kind: "bundled", appId: "context7" })}
                />
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Manage panel */}
      <AnimatePresence>
        {showManagePanel && (
          <ManagePanel
            onClose={() => setShowManagePanel(false)}
            isAuthenticated={isAuthenticated}
            mcpLoading={mcp.mcpLoading}
            isTauri={isTauri}
            context7Server={mcp.context7Server}           context7Running={mcp.context7Running}
            customServers={mcp.customServers}             runningServers={mcp.runningServers}
            groupedComposioConnections={composio.groupedComposioConnections}
            composioApps={composio.composioApps}
            composioPolling={composio.composioPolling}
            onMcpStart={mcp.handleMcpStart}     onMcpStop={mcp.handleMcpStop}
            onMcpToggle={mcp.handleMcpToggle}   onMcpUninstall={mcp.handleMcpUninstall}
            onComposioToggle={composio.handleComposioToggle}
            onComposioDisconnect={composio.handleComposioDisconnect}
          />
        )}
      </AnimatePresence>

      {/* Custom server modal */}
      <AnimatePresence>
        {showCustomModal && (
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCustomModal(false)}>
            <div className="w-full max-w-md mx-4 mb-4 sm:mb-0 bg-surface-base border border-surface-border rounded-3xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-primary">Custom server</h2>
                  <IconButton variant="ghost" size="sm" aria-label="Close" onClick={() => setShowCustomModal(false)}>
                    <Close size="sm" />
                  </IconButton>
                </div>
                {!isAuthenticated ? (
                  <p className="text-xs text-muted">Sign in to add custom servers.</p>
                ) : (
                  <AddServerForm
                    isTauri={isTauri}
                    onInstall={(form) => mcp.handleMcpInstall(form, () => setShowCustomModal(false))}
                    onCancel={() => setShowCustomModal(false)}
                    loading={mcp.addLoading}
                    error={mcp.addError}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Connect modal */}
      <AnimatePresence>
        {connectModal && (
          <AppConnectModal
            config={connectModal.config}
            onClose={() => setConnectModal(null)}
            onPrimary={handleModalPrimary}
            primaryLabel={modalPrimaryLabel}
            primaryDisabled={modalPrimaryDisabled}
            primaryNote={modalPrimaryNote}
            onDestructive={modalDestructiveLabel ? handleModalDestructive : undefined}
            destructiveLabel={modalDestructiveLabel}
            isLoading={modalIsConnecting}
            refMemories={connectRefMemories}
            onToggleRef={() => setConnectRefMemories(v => !v)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
