# Studio Gateway UI

The browser control plane for the Gateway Worker. It is intentionally a separate static deployment from the Worker so the Worker remains focused on request execution and D1 APIs.

## Development

```bash
pnpm install
pnpm dev
```

The Vite server proxies `/admin`, `/health`, and `/ready` to `http://localhost:8787`. Use **local development mode** on the sign-in screen when the Worker is running with `ENVIRONMENT=development` and no `ADMIN_TOKEN`.

## Production

Build with `VITE_GATEWAY_URL` set to the Gateway Worker origin, then deploy `dist` to Cloudflare Pages:

```bash
VITE_GATEWAY_URL=https://gateway.example.com pnpm build
pnpm exec wrangler pages deploy dist
```

Set the Gateway Worker `UI_ORIGIN` variable to the Pages origin. The Worker exposes only normalized request metadata to the UI; prompts, completions, credentials, and provider payloads are not persisted by the analytics layer.
