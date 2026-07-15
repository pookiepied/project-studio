# Studio API Worker

The Studio API Worker is the public cloud entrypoint for `api.example.com`.

It does not own business logic, storage, runtime execution, model calls, or registry state. It forwards authenticated user context to independently deployed workers through explicit service bindings.

Initial route groups:

- `/cloud/runs/*` -> Execution Runtime
- `/cloud/plans/*` -> Planner Runtime
- `/cloud/agents/*` -> Agent Runtime
- `/cloud/conversations/*`, `/cloud/transcripts/*`, `/cloud/uploads/*`, `/cloud/artifacts/*`, `/cloud/objects/*`, `/cloud/plans-data/*` -> Studio Data
- `/cloud/models/*` -> Gateway model list
- `/admin/gateway/*` -> Gateway registry management
- `/local/*` and `/bridge/*` -> reserved for the future local/desktop bridge

Every non-health route currently requires `X-User-ID`. A future auth layer can replace the temporary header requirement while preserving downstream user-scoped forwarding.
