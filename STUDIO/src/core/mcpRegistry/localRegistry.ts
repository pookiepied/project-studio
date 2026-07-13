import { invoke } from "@tauri-apps/api/core";
import { apiManager } from "@/core/network/apiManager";
import { tokenManager } from "@/lib/tokenManager";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

async function syncLocalRegistry(userId: string, machineId: string): Promise<void> {
  const payload = await invoke<Record<string, unknown>>("local_registry_sync_payload", {
    userId,
    machineId,
  });
  const [{ baseUrl }, token] = await Promise.all([
    apiManager.getConfig(),
    tokenManager.getAccessToken(),
  ]);

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/studio/registry/sync/local`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Registry synchronization failed (${response.status}).`);
  }
}

function localMachineId(): string {
  const key = "studio-local-registry-machine-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function currentUserId(): Promise<string | null> {
  const token = await tokenManager.getAccessToken();
  if (!token) return null;

  try {
    const part = token.split(".")[1];
    if (!part) return null;

    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - normalized.length % 4) % 4),
      "="
    );
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function startLocalRegistrySync(): Promise<UnlistenFn> {
  const sync = async () => {
    const userId = await currentUserId();
    if (userId) await syncLocalRegistry(userId, localMachineId());
  };

  await sync().catch(() => {});
  return listen("local-registry-changed", () => {
    void sync().catch(() => {});
  });
}
