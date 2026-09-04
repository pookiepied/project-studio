# ADR-0001 — The pookiepied.dev umbrella

Status: accepted · Date: 2026-08-22 · Supersedes: the `remove/cloudflare-gateway` exploration

Multiple independent applications under `pookiepied.dev`, sharing one identity
authority, with a single operational view. Closed membership — no public signup.
Solo-maintained, so every decision below is weighted toward *the mistake nobody
catches* rather than toward throughput.

---

## 1. Decisions

### 1.1 Opaque session tokens in D1, validated over a service binding

Sessions are 32 random bytes. Only the SHA-256 is stored. App workers validate
by calling `AUTH.validate(token)` through a Cloudflare service binding, which is
a call into another isolate on the same machine — not a network request.

Chosen over stateless JWTs because the usual argument for JWTs is that a central
lookup per request does not scale across regions and services, and a service
binding removes that constraint inside one account. What we get instead:

- **Revocation is instant.** Disabling an account kills every live session in
  the same statement. No token-lifetime window to reason about.
- **No signing key** to rotate, distribute, or leak. No JWKS endpoint, no clock
  skew, no `alg` confusion class of bug.
- **No refresh-token rotation.** Sessions live in D1; extend `expires_at`.

**Upgrade path if it is ever needed:** cache validation as a short-lived (≤90s)
signed value in front of the same D1 truth. The `AuthService` interface does not
change, so no app worker is touched.

### 1.2 No gateway worker. Addressing by Cloudflare route.

`api.pookiepied.dev/v1/<app>/*` routes **directly** to each app worker.
Cloudflare's edge router does path dispatch; there is no process in between.

The single-hostname addressing was worth having — one DNS record, one cert, one
CORS origin, one address to configure. The gateway *process* was not, and the
reason is not latency (a service binding is fast; that objection was wrong):

- A gateway is either **dumb** — validating and forwarding, duplicating what
  Cloudflare routes and the shared package already do — or **smart**, enforcing
  per-app authorization, which means absorbing every app's semantics and
  becoming the ceiling on what any app can express. There is no stable middle;
  gateways drift toward smart, and the coupling arrives with them.
- One deployable in front of everything means one bad deploy takes down every
  app at once. Solo, with no staging, that is the failure that actually happens.
- A gateway holds every credential for every app in one isolate. A bug there is
  not a leak, it is the whole umbrella.

**Insertable later without breaking a URL:** route matching is most-specific-
wins, so `api.pookiepied.dev/*` can be added as a catch-all beneath the existing
specific routes and apps migrated behind it one at a time. Commit to the
addressing (expensive to change — it is baked into every client); stay
uncommitted on the process (invisible from outside, therefore cheap).

**Trigger to revisit:** a third-party public API — external developers we do not
control, API keys, published contracts, quota billing. Then the coupling is the
point. Not before.

### 1.3 Private workers come from having no route, not from a gateway

A worker is reachable only if given an address. No route + `workers_dev = false`
+ `preview_urls = false` means the only ingress is a service binding. Every
public worker is its own front door to its own private internals.

The real exposure risk is not "we did not build a gateway", it is a forgotten
`workers.dev` subdomain serving an unauthenticated internal worker. That is a
per-worker checklist item (§4), and a gateway would not have prevented it.

### 1.4 One owner per database

- The **auth worker** exclusively owns the identity D1. Nothing else binds to it.
- **Application data** lives in the owning app's own D1. No shared app database.
- The **console** reaches user data through `AdminService` RPC, not by binding
  the identity D1 — so mutations keep one code path and one audit trail.

No `data` worker is created until two apps genuinely need the same data. Empty
scaffolding rots: stale deps, drifted config, and a deployed worker nobody
remembers. Decide the rule now, create the worker when it has a job.

### 1.5 Two capability-scoped entrypoints on the auth worker

`AuthService.validate()` is bound by every app. `AdminService` (invite, disable,
revoke, audit) is bound **only** by the console. A compromised app worker holds
no capability to mutate accounts — it was never handed the entrypoint.

### 1.6 Telemetry: ingest and console are separate workers

`telemetry.pookiepied.dev` is one worker with two doors: `tail()` receives
Cloudflare's firehose from every worker naming it in `tail_consumers`, and
`fetch()` accepts `POST /v1/events` from anything outside Cloudflare (a desktop
build, a web project, a future service) authenticated by a per-source write key.

Out-of-band collection beats a gateway for the same job: it runs after the
response so it cannot add latency, it still sees requests that *crashed*, it
cannot take traffic down if it breaks, and a new app joins by adding one line to
its own config. It also sees app-level events (`track()` lines), not just HTTP
envelopes — a gateway only ever sees what is on the wire.

`console.pookiepied.dev` is **read-only with respect to telemetry**: it queries
Analytics Engine and holds no write key. Opposite threat models — one is the
most-exposed public endpoint, the other is the most-privileged reader — so they
do not share a process.

**Storage split:** Analytics Engine for volume (requests, latency, errors,
counters). D1 for what must join against users (auth events, admin actions,
audit). Pushing request-level volume into D1 is the tempting mistake; it will
fall over.

**Naming:** the hostname is `telemetry`, the caller-facing noun is in the path
(`/v1/events`). Hostnames are named for callers, not for the worker's job, so
`/v1/otlp` can appear later without the hostname lying.

**Deferred:** OpenTelemetry. The ingest worker is the natural translation
boundary if a future project speaks OTLP. Paths are versioned from day one so
that is an addition, never a migration.

### 1.7 Control plane on its own hostname, behind Cloudflare Access

Access terminates unauthenticated requests at the edge; the console worker never
runs for them. The worker verifies the Access JWT anyway (`aud`, `iss`, `exp`,
RS256 against the team JWKS) so its safety does not depend on a route being
configured correctly.

It then asks a second, different question: Access said *this person may reach
the console*, and the umbrella still has to say *this person administers it*.
The verified email is resolved through `AdminService.operator()` and refused
unless that row is `role = 'admin'` and `status = 'active'`. Without that step
the Access policy would be the entire authorization, and widening it later —
to a domain, a group, a second person — would hand full account control to
everyone it newly admits, with nothing in the code changing or failing to mark
the moment. Authorization belongs in the identity database, not in a Cloudflare
policy this repository cannot see.

**Not folded into the API**, though it was considered. Sharing a hostname puts
the most and least privileged surfaces behind one router, one origin, one cookie
scope, one deploy. Path-scoped Access policies have a fail-open shape — a
trailing slash, a case assumption, a greedier-than-intended pattern — and
hostname-scoped ones do not.

**On the name:** `console` rather than `admin` is worth ~nothing as security.
Subdomain names are normally enumerable through Certificate Transparency logs;
they are not here only because Cloudflare Universal SSL issues one wildcard for
the zone. Never provision a per-hostname cert (§4). But the name carries none of
the security load — Access does all of it.

### 1.8 Two roles, one column

`users.role` is one of `admin` or `user`. Admin is the operator. No permissions
table, no RBAC — two roles need a column, not a subsystem.

**Upgrade path:** if a second app ever needs different roles from the first,
this becomes `memberships(user_id, app, role)`. One migration. Do not pre-build.

### 1.9 Accounts are allowlist-only

`status` is one of `invited`, `active`, `disabled`. `invited` is
allowlisted-but-never-logged-in; there is no separate allowlist table, because
two tables describing the same person drift. There is no signup path in the auth
worker: an email with no row is refused at callback.

### 1.10 Sessions issued two ways from day one

`Set-Cookie: __Host-session` (HttpOnly, Secure, SameSite=Lax) for browsers; a
one-time handoff code exchanged over `POST /oauth/exchange` for desktop clients
on an RFC 8252 loopback redirect. The handoff row holds a **user id, never a
token** — the session is minted at exchange time, so no *session token* is ever
placed in a URL or stored at rest.

The one-time code itself does travel in the loopback URL; that is what the
redirect is for. So each side of the flow is bound to the party that began it,
and neither binding is optional:

- **Web** — the `state` is also set as a short-lived `__Host-` cookie and must
  match at the callback. The row alone proves only that *someone* started a
  flow; without the pair, an attacker can walk a victim's browser through their
  own callback and leave the victim signed in as them.
- **Desktop** — the client sends its own PKCE challenge at `/oauth/start` and
  its verifier at `/oauth/exchange`. This is a second pair, separate from the
  one the worker uses against Google: that one binds us to Google, this one
  binds the code to the process that asked for it, so a local race for the
  loopback port wins nothing.

~15 lines in one place now, versus retrofitting the token model when STUDIO
adopts the umbrella later.

---

## 2. Shape

```
auth.pookiepied.dev            auth worker · owns identity D1
                               AuthService.validate()  -> every app
                               AdminService.*          -> console only

api.pookiepied.dev/v1/<app>/*  Cloudflare routes -> app workers directly
                               (no gateway; none deployed yet)

  app worker --(binding)--> private workers   no route, no workers.dev

telemetry.pookiepied.dev       tail() from every worker + fetch() from outside
                               -> Analytics Engine

console.pookiepied.dev         Cloudflare Access · reads AE + AdminService
```

---

## 3. Joining the umbrella

Three steps, no auth code written:

```
1. pnpm add @pookiepied/core
2. wrangler.toml: AUTH service binding, tail_consumers, route
3. export default withAuth({ public: [...], fetch: (req, ctx) => ... })
```

If it ever takes more than that, `@pookiepied/core` is missing something.

---

## 4. The mistakes this is shaped to prevent

The failure to design against is not broken cryptography. It is **missing
authorization** — an authenticated user reaching something that is not theirs.
Expertise does not prevent it; structure does.

1. **Deny by default.** `withAuth` protects every route unless it matches an
   explicit `public` rule, and public routes go to a *different handler*, so
   "public" is visible in the code's shape. Forgetting yields a locked door.
2. **Identity never comes from the request.** No code path reads a user id from
   a header, body, or query parameter. There is no API for the unsafe thing.
3. **Ownership lives in the query.** `ctx.owned(db)` puts `user_id = ?` in every
   statement. `OwnedDb` has no unscoped escape hatch — an omitted check is a
   type error, not a silent hole.
4. **The ownership column is not writable.** `user_id` is set by `OwnedDb` and
   refused in the values of an insert or an update, so the column the WHERE
   clause checks cannot be reassigned by the caller it protects. A check in the
   query is only worth something if the thing it checks is out of reach.
5. **404, not 403,** for rows we do not own. A 403 confirms existence and hands
   over an enumeration oracle.
6. **Every gate is checked twice, by different authorities.** Access *and* the
   role column for the console; the state row *and* a browser cookie for a web
   login; our PKCE pair *and* the client's for a desktop one. Each pair is two
   parties that would both have to be wrong.
7. **The attack is a test.** `packages/core/test/authz.test.ts` asserts each of
   the above, including the forgotten-route case, the spoofed-header case, and
   the ownership-reassignment case; `workers/console/test/access.test.ts`
   forges assertions against the real verifier. Per-app: authenticate as B,
   request A's ids on every route, expect 404.

### Deploy checklist — per worker

```
[ ] workers_dev = false
[ ] preview_urls = false
[ ] no route on internal workers
[ ] secrets via `wrangler secret put`, never in wrangler.toml
[ ] cookies: __Host- prefix, HttpOnly, Secure, SameSite=Lax
[ ] Access enforced on console — verify by loading it logged out
[ ] wildcard cert only; never provision a per-hostname cert
[ ] tail_consumers points at pookiepied-telemetry
```

---

## 5. Deferred, with the trigger that would justify each

| Deferred | Build it when |
| --- | --- |
| Gateway worker at `api/*` | A third-party public API exists — external devs, API keys, quotas |
| JWT / JWKS / stateless validation | Validation latency is measured and actually matters |
| DPoP / sender-constrained tokens | Token theft is a realistic threat, i.e. membership is no longer closed |
| Passkeys / WebAuthn | Access-level assurance stops being enough for the console |
| OpenTelemetry | A project outside Cloudflare needs distributed tracing |
| `memberships` table | A second app needs different roles from the first |
| `data` worker | Two apps need the same data |
| Rate limiting in code | Cloudflare's declarative rules stop being sufficient |

The triggers matter more than the list. Without them these get re-argued from
scratch, or built early "just in case", which is the same over-engineering by a
different route.
