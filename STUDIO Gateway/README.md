# Studio Gateway

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
