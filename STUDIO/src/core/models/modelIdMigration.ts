const MODEL_MIGRATIONS: Record<string, string> = {
  "whisper-large-v3-turbo": "groq:whisper-large-v3-turbo",
  "whisper-large-v3": "groq:whisper-large-v3",
  "llama-3.1-8b-instant": "groq:llama-3.1-8b-instant",
  "llama-3.3-70b-versatile": "groq:llama-3.3-70b-versatile",
  "llama-3.3-70b-specdec": "groq:llama-3.3-70b-specdec",
  "llama-guard-3-8b": "groq:llama-guard-3-8b",
};

export function migrateModelId(oldId: string): string {
  if (oldId.includes(":")) return oldId;
  return MODEL_MIGRATIONS[oldId] ?? `groq:${oldId}`;
}
