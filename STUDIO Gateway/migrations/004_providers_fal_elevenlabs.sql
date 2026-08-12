-- Add fal and elevenlabs for image/audio generation categories

INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at) VALUES
  ('fal', 'Fal', 'https://api.fal.ai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('elevenlabs', 'ElevenLabs', 'https://api.elevenlabs.io/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000)
ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, protocol=excluded.protocol, enabled=excluded.enabled, updated_at=excluded.updated_at;
