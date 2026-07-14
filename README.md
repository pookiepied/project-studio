# Project Studio

This repository is organized by runtime and responsibility.

## Folder Map

| Folder | Purpose |
|---|---|
| `STUDIO/` | Desktop/local Studio application. Kept in place during this organization pass. |
| `api/` | Public API Worker intended to front `api.example.com` and route public/client requests into internal cloud services. |
| `auth/` | Authentication worker. |
| `Backend/Cloud/` | Cloud runtime services, connectors, data, registry, runtime workers, tracker, and the active model gateway. |
| `Backend/legacy (Will be removed)/` | Legacy cloud systems retained only during migration, especially the old chat loop. |
| `Backend/shared/` | Reusable packages shared by backend workers. |
| `Discord Bot/` | Discord bot project. |
| `docs/Architecture/` | Architecture briefs and working design documents. |
| `Research/` | Existing research/reference material. Left with its original casing to avoid Windows case-only path churn. |
| `scratch/` | Temporary local scratch material. |

## Cloud Worker Categories

- Public entrypoint: `api/`
- Model gateway: `Backend/Cloud/gateways/gateway/`
- Legacy chat loop: `Backend/legacy (Will be removed)/chat/`
- Capability services: `Backend/Cloud/`
- Runtime services: `Backend/Cloud/runtime/`

## Notes

- `STUDIO/` remains the desktop/local Studio application.
- Existing worker names in `wrangler.toml` are the Cloudflare deployment names; folder names are repository organization.
