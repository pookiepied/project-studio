import { useCallback, useState } from "react";
import {
  HardDrivesIcon as HardDrives,
  FolderIcon as Folder,
  WrenchIcon as Wrench,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Icon } from "@/ui/icons";
import {
  listGlobalMachineGrants,
  revokeGlobalMachineGrant,
  listWorkspaceTrust,
  revokeWorkspaceTrust,
  listGlobalToolGrants,
  listWorkspaceToolGrants,
  revokeToolGrant,
  clearAllPermissions,
} from "@/permissions";
import { SectionLabel } from "./SectionLabel";

/**
 * Settings > Permissions - the management surface for everything the permission
 * engine treats as durable, user-granted state:
 *
 *   - the global machine-access grant (broad, no-project file access),
 *   - remembered workspace-trust decisions,
 *   - per-tool approvals recorded at global or workspace scope.
 *
 * It only reads / revokes; grants are *created* in-chat through the trust modal,
 * global-access modal, and per-action approval prompts. Reading straight from
 * the same `perm:` store (via `@/permissions`) keeps this view and the engine
 * from ever drifting. MCP server *enablement* lives in Local AI > System
 * Integration and is intentionally not duplicated here.
 */
export const PermissionsView = () => {
  // Force a re-render after every mutation so the reads below re-pull the
  // (localStorage-backed) store. The counter value itself is never read.
  const [, forceRefresh] = useState(0);
  const refresh = useCallback(() => forceRefresh((v) => v + 1), []);

  const machineGrants = listGlobalMachineGrants();
  const trustEntries  = listWorkspaceTrust();
  const globalTools   = listGlobalToolGrants();
  const workspaceTools = listWorkspaceToolGrants();

  const nothingGranted =
    machineGrants.length === 0 &&
    trustEntries.length === 0 &&
    globalTools.length === 0 &&
    workspaceTools.length === 0;

  return (
    <>
      {/* GLOBAL MACHINE ACCESS */}
      <section className="space-y-4">
        <SectionLabel
          icon={<Icon icon={HardDrives as unknown as PhosphorIcon} size="md" />}
          title="MACHINE ACCESS"
        />
        <div className="flex flex-col gap-3 py-4 border-b border-surface-divider sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 sm:pr-6">
            <p className="text-sm font-normal text-secondary">Global file access</p>
            <p className="mt-0.5 text-xs text-muted">
              {machineGrants.length > 0
                ? `${machineGrants.length} conversation${machineGrants.length === 1 ? "" : "s"} can read and modify files anywhere on this machine.`
                : "Not granted - chats without a project folder must ask before touching local files."}
            </p>
          </div>
          <span className="text-xs text-muted whitespace-nowrap">
            {machineGrants.length > 0 ? "Scoped by chat" : "Off"}
          </span>
        </div>
        {machineGrants.map((grant) => (
          <ToolGrantRow
            key={grant.conversationId}
            tool={`Conversation ${grant.conversationId}`}
            onRevoke={() => { revokeGlobalMachineGrant(grant.conversationId); refresh(); }}
          />
        ))}
      </section>

      {/* TRUSTED WORKSPACES */}
      <section className="space-y-4">
        <SectionLabel
          icon={<Icon icon={Folder as unknown as PhosphorIcon} size="md" />}
          title="WORKSPACE TRUST"
        />
        {trustEntries.length === 0 ? (
          <EmptyRow text="No workspaces have a saved trust decision yet." />
        ) : (
          <div>
            {trustEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 py-4 border-b border-surface-divider sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 min-w-0 sm:pr-6">
                  <p className="text-sm font-normal text-secondary truncate">
                    {basename(entry.id)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted font-mono truncate">{entry.id}</p>
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <TrustBadge trusted={entry.trust === "trusted"} />
                  <RevokeButton
                    label="Forget"
                    onClick={() => { revokeWorkspaceTrust(entry.id); refresh(); }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* TOOL APPROVALS */}
      <section className="space-y-4">
        <SectionLabel
          icon={<Icon icon={Wrench as unknown as PhosphorIcon} size="md" />}
          title="TOOL APPROVALS"
        />
        {globalTools.length === 0 && workspaceTools.length === 0 ? (
          <EmptyRow text="No tools have been permanently approved. Approvals you grant for this chat are session-only." />
        ) : (
          <div className="space-y-6">
            {globalTools.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted">Always allowed (all workspaces)</p>
                {globalTools.map((tool) => (
                  <ToolGrantRow
                    key={`g:${tool}`}
                    tool={tool}
                    onRevoke={() => { revokeToolGrant(tool, null); refresh(); }}
                  />
                ))}
              </div>
            )}
            {workspaceTools.map(({ workspaceId, tools }) => (
              <div key={`ws:${workspaceId}`}>
                <p className="mb-1 text-xs text-muted font-mono truncate">{basename(workspaceId)}</p>
                {tools.map((tool) => (
                  <ToolGrantRow
                    key={`${workspaceId}:${tool}`}
                    tool={tool}
                    onRevoke={() => { revokeToolGrant(tool, workspaceId); refresh(); }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* RESET */}
      {!nothingGranted && (
        <section className="pt-2">
          <button
            onClick={() => { clearAllPermissions(); refresh(); }}
            className="text-xs font-medium text-secondary hover:text-secondary transition-colors"
          >
            Revoke all permissions
          </button>
          <p className="mt-1 text-2xs text-muted">
            Clears every trust decision, machine grant, and saved tool approval. The AI will ask again next time.
          </p>
        </section>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function RevokeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium text-secondary hover:text-secondary border border-surface-border rounded-lg px-2.5 py-1 transition-colors whitespace-nowrap"
    >
      {label}
    </button>
  );
}

function TrustBadge({ trusted }: { trusted: boolean }) {
  return (
    <span
      className={`text-2xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
        trusted
          ? "text-secondary bg-surface-raised/10"
          : "text-secondary bg-surface-raised/10"
      }`}
    >
      {trusted ? "Trusted" : "Limited"}
    </span>
  );
}

function ToolGrantRow({ tool, onRevoke }: { tool: string; onRevoke: () => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-surface-divider">
      <span className="text-sm font-mono text-secondary truncate">{tool}</span>
      <RevokeButton label="Revoke" onClick={onRevoke} />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-4 text-xs text-muted border-b border-surface-divider">{text}</p>;
}

/** Last path segment of a normalised workspace id, for a friendlier label. */
function basename(id: string): string {
  const trimmed = id.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}
