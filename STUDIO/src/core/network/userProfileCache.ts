import { apiManager } from './apiManager';
import { createHeaders } from '../../utils/api';

interface UserProfile {
  name: string;
  picture: string;
}

const cache = new Map<string, UserProfile>();
const pending = new Map<string, Promise<void>>();

async function fetchMissing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const endpoints = await apiManager.getEndpoints();
    const headers = await createHeaders();
    const res = await fetch(`${endpoints.auth}/users/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return;
    const data = await res.json() as { users: Record<string, UserProfile> };
    for (const [id, profile] of Object.entries(data.users ?? {})) {
      cache.set(id, profile);
    }
  } catch {
    // silently fail — avatars fall back to initials
  }
}

function dedupFetch(ids: string[]): Promise<void> {
  const key = ids.sort().join(",");
  if (pending.has(key)) return pending.get(key)!;
  const p = fetchMissing(ids).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export function getCachedProfile(userId: string): UserProfile | undefined {
  return cache.get(userId);
}

export function prefetchProfiles(userIds: string[]): void {
  const missing = userIds.filter((id) => !cache.has(id) && id !== "anonymous");
  if (missing.length > 0) dedupFetch(missing);
}
