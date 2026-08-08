/**
 * useModes — fetches the user-facing tier config (Auto/Fast/Standard/Advanced)
 * from the AI gateway at runtime.
 *
 * The gateway is the single source of truth. Changing which model a tier uses
 * only requires updating ai/src/gateway/config/modes.ts and redeploying the
 * worker — no frontend deploy needed.
 *
 * Falls back to the static values in autoMode.ts if the API is unreachable.
 */

import { useState, useEffect } from "react";
import { apiManager } from "@/core/network/apiManager";
import { AI_MODES, type AIMode } from "@/core/config/autoMode";

interface UsemodesResult {
  modes: AIMode[];
  loading: boolean;
}

const CACHE_KEY = "studio:modes";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  modes: AIMode[];
  fetchedAt: number;
}

function readCache(): AIMode[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry.modes;
  } catch {
    return null;
  }
}

function writeCache(modes: AIMode[]) {
  try {
    const entry: CacheEntry = { modes, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage quota exceeded or private mode — ignore
  }
}

export function useModes(): UsemodesResult {
  const cached = readCache();
  const [modes, setModes] = useState<AIMode[]>(cached ?? AI_MODES);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    // Already have a fresh cache — skip fetch
    if (cached) return;

    let cancelled = false;

    async function fetchModes() {
      try {
        const endpoints = await apiManager.getEndpoints();
        if (!endpoints.modes) return;

        const res = await fetch(endpoints.modes);
        if (!res.ok) return;

        const json: { data: AIMode[] } = await res.json();
        if (!cancelled && Array.isArray(json.data) && json.data.length > 0) {
          setModes(json.data);
          writeCache(json.data);
        }
      } catch {
        // Network failure — static fallback already in state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchModes();
    return () => { cancelled = true; };
    // cache snapshot intentionally read at mount; re-fetch would loop on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { modes, loading };
}
