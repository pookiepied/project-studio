import type { ChatEngine } from "../../../cliBridges/types";

const STORAGE_KEY = "studio:chat-engine-preferences:v1";
const LOCAL_EMPTY_KEY = "__local_empty__";

type PreferenceMap = Record<string, ChatEngine>;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readPreferences(): PreferenceMap {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PreferenceMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: PreferenceMap): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preference persistence is best-effort; chat state remains authoritative.
  }
}

export function getPreferredChatEngine(conversationId?: string | null): ChatEngine | null {
  const key = conversationId || LOCAL_EMPTY_KEY;
  const value = readPreferences()[key];
  return value === "studio" || value === "claude" ? value : null;
}

export function savePreferredChatEngine(engine: ChatEngine, conversationId?: string | null): void {
  const key = conversationId || LOCAL_EMPTY_KEY;
  writePreferences({
    ...readPreferences(),
    [key]: engine,
    ...(engine ? { [LOCAL_EMPTY_KEY]: engine } : {}),
  });
}
