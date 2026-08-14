-- Add nvidia and perplexity (present in catalog/defaults.ts but missing from DDL seed)
-- and fix fireworks base_url to include /v1 to match defaults.ts

INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at) VALUES
  ('nvidia', 'NVIDIA', 'https://integrate.api.nvidia.com/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('perplexity', 'Perplexity', 'https://api.perplexity.ai', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000)
ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, protocol=excluded.protocol, updated_at=excluded.updated_at;

-- Fix fireworks URL drift (was /inference, should be /inference/v1)
UPDATE providers SET base_url = 'https://api.fireworks.ai/inference/v1', updated_at = unixepoch('now')*1000 WHERE id = 'fireworks' AND base_url = 'https://api.fireworks.ai/inference';
