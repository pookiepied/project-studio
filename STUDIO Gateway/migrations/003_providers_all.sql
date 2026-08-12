-- Add all remaining providers in one pass - regular global only, no cn variants
-- All use openai-completions except anthropic/google which already exist

INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at) VALUES
  ('alibaba', 'Alibaba Qwen', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('cohere', 'Cohere', 'https://api.cohere.com/compatibility/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('deepseek', 'DeepSeek', 'https://api.deepseek.com', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('fireworks', 'Fireworks', 'https://api.fireworks.ai/inference', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('groq', 'Groq', 'https://api.groq.com/openai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('huggingface', 'Hugging Face', 'https://router.huggingface.co/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('minimax', 'MiniMax', 'https://api.minimax.chat/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('mistral', 'Mistral', 'https://api.mistral.ai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('moonshot', 'Moonshot', 'https://api.moonshot.ai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('together', 'Together', 'https://api.together.xyz/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('xai', 'xAI', 'https://api.x.ai/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('xiaomi', 'Xiaomi MiMo', 'https://api.xiaomimimo.com/v1', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('zai', 'ZAI', 'https://api.z.ai/api/paas/v4', 'openai-completions', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000)
ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, protocol=excluded.protocol, enabled=excluded.enabled, updated_at=excluded.updated_at;
