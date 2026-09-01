# Backend — the pookiepied.dev umbrella

Identity, telemetry, and the control plane for every app under
`pookiepied.dev`. Design decisions and their rationale live in
[`docs/adr/0001-umbrella-architecture.md`](../docs/adr/0001-umbrella-architecture.md) —
read that before changing anything structural here.

```
packages/core       withAuth, OwnedDb, track — what every app worker imports
packages/client     login + telemetry for browsers and desktop builds
workers/auth        Google OAuth, sessions, the identity D1
workers/telemetry   tail() from every worker + public /v1/events ingest
workers/console     Cloudflare Access · read-only dashboard + allowlist
```

Nothing here is deployed yet. Every `REPLACE_ME` in a `wrangler.toml` is a
required step below.

## First-time setup

```bash
pnpm install
```

**1 · Identity database**

```bash
cd workers/auth
wrangler d1 create pookiepied-identity   # paste database_id into wrangler.toml
pnpm migrate:remote
```

**2 · Google OAuth**

Create an OAuth client (Web application) in Google Cloud Console with the
redirect URI `https://auth.pookiepied.dev/oauth/callback`, then:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

**3 · Seed the first admin.** There is no signup path — an email with no row is
refused at callback, including yours.

```bash
wrangler d1 execute pookiepied-identity --remote --command \
  "INSERT INTO users (id,email,name,role,status,created_at,updated_at) VALUES (lower(hex(randomblob(16))),'you@example.com',NULL,'admin','invited',unixepoch()*1000,unixepoch()*1000)"
```

**4 · Telemetry write keys.** One random key per source that reports from
outside Cloudflare:

```bash
cd ../telemetry
wrangler secret put INGEST_KEYS   # {"studio":"<random>","site":"<random>"}
```

The seeded row must be `role = 'admin'`. Access decides who may reach the
console; this column decides who may administer the umbrella, and the console
refuses anyone whose row is not an active admin — so seeding a `user` row and
expecting the dashboard to open will not work.

**5 · Console behind Access.** In the Cloudflare dashboard, create a
Zero Trust → Access application for `console.pookiepied.dev`, allow only your
email, then fill `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in
`workers/console/wrangler.toml`. Also set `CF_ACCOUNT_ID`, check that
`CONSOLE_ORIGIN` matches the route exactly — it is compared against the `Origin`
header of every mutating request, so a mismatch makes the dashboard read-only —
and set:

```bash
wrangler secret put CF_API_TOKEN   # read-only, Account Analytics:Read
```

**6 · Deploy in dependency order** — the auth worker must exist before anything
binds to it.

```bash
pnpm deploy:auth
pnpm deploy:telemetry
pnpm deploy:console
```

Then load `console.pookiepied.dev` **in a logged-out browser** and confirm you
are stopped by Access. That check is the one that catches a misconfigured
policy, and nothing else will.

## Adding an app worker

```bash
pnpm add @pookiepied/core
```

```toml
# wrangler.toml
routes = [{ pattern = "api.pookiepied.dev/v1/app1/*", zone_name = "pookiepied.dev" }]
workers_dev = false
preview_urls = false

[[services]]
binding = "AUTH"
service = "pookiepied-auth"
entrypoint = "AuthService"

tail_consumers = [{ service = "pookiepied-telemetry" }]
```

```ts
import { withAuth, json, type UmbrellaEnv } from "@pookiepied/core";

interface Env extends UmbrellaEnv { DB: D1Database }

export default withAuth<Env>({
  public: ["GET /v1/app1/health"],
  publicFetch: async () => json({ ok: true }),
  fetch: async (req, ctx) => {
    const doc = await ctx.owned(ctx.env.DB).get("docs", "abc");
    return json({ doc });
  },
});
```

Every route is protected unless listed in `public`, and `ctx.owned()` is the
only sanctioned way to read user data — it puts `user_id = ?` in the query so
the check cannot be forgotten. Private downstream workers get no `routes` entry
at all; a service binding is their only ingress.

Copy `packages/core/test/authz.test.ts` as the starting point for the app's own
authorization tests, and add the per-app case: authenticate as user B, request
user A's resource ids on every route, expect 404.

## Checks

```bash
pnpm typecheck
pnpm test
```
