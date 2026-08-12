-- Add Google and enable OpenAI (adapters now implemented)

INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at) VALUES
  ('google', 'Google', 'https://generativelanguage.googleapis.com', 'google-generative-ai', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000)
ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, protocol=excluded.protocol, enabled=excluded.enabled, updated_at=excluded.updated_at;

UPDATE providers SET enabled = 1, base_url = 'https://api.openai.com/v1', protocol = 'openai-completions', updated_at = unixepoch('now')*1000 WHERE id = 'openai';
