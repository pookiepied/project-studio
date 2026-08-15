# Studio Gateway

> ## Retired — kept as reference, not as a component
>
> **This is not part of Project Studio 1.0.** It is not built, not tested, not
> shipped, and nothing in `STUDIO HARNESS/` imports or calls it. Its own
> `package.json`, lockfile, `tsconfig.json` and `wrangler.toml` make it fully
> self-contained; the Harness build, test suite, typecheck and architecture
> tests do not touch this directory.
>
> It is a **Cloudflare Worker**. The replacement is a local TypeScript gateway
> bundled with Studio, so the deployment-shaped half of this code — `wrangler`
> configuration, platform bindings, edge authentication, multi-tenant rate
> limiting — does not carry over. What is kept for reference is the design:
> provider catalog and discovery, SSE translation, usage projection, and the
> `UI/` control plane's analytics.
>
> **It was never a backend for this Harness.** ADR 0031 records why: the Worker
> speaks OpenAI-compatible routes, snake_case, and `sk-gw_*` keys, while the
> Harness adapter speaks typed SSE events, camelCase, and Studio session
> tokens. Do not treat one as an implementation of the other.
>
> Retained deliberately under issue #14 of `documentation/work/phases-1-11-remediation.md`,
> which reversed an earlier decision to delete it. Everything below this box
> describes the retired Worker and is left unedited as a record of how it ran.

The Gateway Worker and its browser control plane are separate processes during
development:

```bash
# Terminal 1: local D1 + Worker API
pnpm db:migrate --local
pnpm dev

# Terminal 2: browser UI
cd UI
pnpm install
pnpm dev
```

From a terminal on the VPS host, both processes can be started together:

```bash
bash "/workspace/Projects/ProjectStudio/STUDIO Gateway/scripts/run-host.sh"
```

This command must be run on the VPS host. Running it inside the OpenCode
container still creates container-local listeners.

Open `http://localhost:4173`. The UI proxies management calls to
`http://localhost:8787`. In local development, use **local development mode**
unless an `ADMIN_TOKEN` is configured.

Useful checks:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/ready
curl http://localhost:8787/admin/providers
curl http://localhost:8787/admin/models?limit=20
curl -X POST http://localhost:8787/admin/discovery/run
```

The UI uses the Worker management API; it does not contain provider, catalog,
credential, deployment, or analytics business logic. See
`docs/implementation-status.md` for the implementation boundary and remaining
categories.
