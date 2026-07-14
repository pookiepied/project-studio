# Project Studio

This repository is organized by runtime and responsibility.

## Folder Map

| Folder | Purpose |
|---|---|
| `STUDIO/` | Desktop/local Studio application. Kept in place during this organization pass. |
| `cloud/api-worker/` | Public API Worker intended to front `api.example.com` and route public/client requests into internal cloud services. |
| `cloud/gateways/` | Model-provider gateway implementations, including the legacy gateway and gateway v2. |
| `cloud/services/` | Cloud service workers such as auth, agents, skills, MCP, connectors, tracker, chat storage, and the Studio preferences worker. |
| `cloud/runtime-v2/` | V2 cloud runtime services: context, registry, data, planner runtime, execution runtime, agent runtime, and their shared contracts/runtime helpers. |
| `cloud/legacy/` | Legacy cloud systems that are still useful or required during migration, especially the old chat loop. |
| `shared/packages/` | Reusable packages shared by cloud workers. |
| `apps/` | Non-desktop app-side projects, currently the Studio bot. |
| `docs/architecture/` | Architecture briefs and working design documents. |
| `Research/` | Existing research/reference material. Left with its original casing to avoid Windows case-only path churn. |
| `scratch/` | Temporary local scratch material. |

## Cloud Worker Categories

- Public entrypoint: `cloud/api-worker/`
- Model gateway: `cloud/gateways/gateway-v2/`
- Legacy gateway: `cloud/gateways/gateway/`
- Legacy chat loop: `cloud/legacy/chat/`
- Capability services: `cloud/services/`
- Runtime services: `cloud/runtime-v2/`

## Notes

- `node_modules` folders outside `STUDIO/` were removed during organization. Reinstall dependencies per worker as needed.
- `STUDIO/` was not moved or edited during the organization pass.
- Existing worker names in `wrangler.toml` were not changed; only repository paths changed.
