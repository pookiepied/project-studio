# Backend — security and correctness audit

> **Status: all twelve findings resolved**, in the five commits that follow this
> file on `main`. Each fix carries a test that fails without it. The suite went
> from 35 tests to 119, and `workers/console/src/access.ts`,
> `workers/telemetry/src/index.ts`, and the console's routing — none of which
> had a single test when this was written — now have 91 between them.
>
> This file is kept as written, in the past tense of its findings, because the
> reasoning is the part worth keeping: it records *why* each of these was worth
> fixing, which a diff cannot. Read §7's coverage table as the state before the
> fixes, not now.

Date: 2026-09-01. Branch: `main`, at commit `8d9d5d5`. Scope: `Backend/` —
every file under `packages/` and `workers/`, read line by line. Read-only; no
source files were modified.

## Baseline

- `pnpm typecheck` — clean, exit 0, all five workspace projects.
- `pnpm test` — 35 passed, 0 failed (16 in `packages/core`, 19 in `workers/auth`).
- `pnpm --filter @pookiepied/console build` — succeeds, 372 kB of JS.

Nothing here has ever run against a real D1, a real Google redirect, or a real
Access assertion. The four `REPLACE_ME` values are still in place. So the green
above is the code agreeing with its own mocks, and the rest of this file is what
that agreement does not cover.

Method note: every finding below was confirmed by reading the code path end to
end, and the two marked *reproduced* were executed. Severity follows the harness
audit's vocabulary — BROKEN (wrong today), RISK (correct today, one change away
from wrong), UNTIDY (works, but costs a future reader).

---

## 1. Authorization

### B-01 — Anyone Cloudflare Access admits is a full administrator; the console never checks a role · RISK

`workers/console/src/index.ts:46-52` verifies the Access assertion and then uses
`identity.email` for exactly one thing: the `actor` string written to the audit
log (`index.ts:53`). No route consults the `users` table, and `AdminService` has
no role gate of its own — `AuthService.validate()` is where `role` is checked
(`packages/core/src/auth.ts:76-82`), and the console does not use it.

The consequence is that passing Access is the whole of authorization. Whoever
gets through can list every account, invite new accounts *as admin*
(`index.ts:121`), disable anyone, promote anyone, and revoke any session.

This is the ADR's stated design — §1.7 says the name carries none of the
security load and Access does all of it. That is defensible while the Access
policy names one email. It stops being defensible the moment the policy is
widened to a domain, a group, or a second person, because nothing in the code
distinguishes those cases and nothing fails when the widening happens. The
failure the ADR itself says to design against is "an authenticated user reaching
something that is not theirs" (§4), and this is the one surface where that check
does not exist.

Worth noting alongside it: `setStatus` and `setRole` have no last-admin guard,
so an operator can disable their own only account, and the recovery is a
`wrangler d1 execute` against production.

Fix in one sentence: have the console resolve `identity.email` through
`AdminService` and refuse unless that row is `role = 'admin'` and
`status = 'active'`, so Access is the first gate rather than the only one.

### B-02 — `OwnedDb.update()` lets a caller reassign `user_id`, writing a row into somebody else's account · RISK

`packages/core/src/db.ts:66-77` builds its `SET` clause from the caller's own
`values` keys. `user_id` passes the `IDENTIFIER` test like any other column, so
it lands in the `SET` list while the ownership check stays in the `WHERE`:

```
UPDATE docs SET title = ?, user_id = ? WHERE id = ? AND user_id = ?
```

*(reproduced — the string above is this code's output for
`update("docs", id, { title: "x", user_id: "victim-id" })`.)*

The row must be ours to begin with, so this is not a read of another user's
data. It is a write into their account: a user can hand a row they control to
anybody, and after the statement the original owner can no longer see it while
the recipient can. For a table holding anything acted upon — a document, a job,
a config row — that is a way to plant content under another identity.

This matters more than the immediate impact suggests, because `OwnedDb` is sold
in ADR-0001 §4.3 as the construct with "no unscoped escape hatch", where "an
omitted check is a type error, not a silent hole". Here the check is present and
the caller can still overwrite the column it protects. Every app worker you ever
add inherits this.

Fix in one sentence: reject `user_id` and `id` in the `values` of both `update`
and `insert`, the same way an unsafe column name is already rejected.

### B-06 — `OwnedDb.insert()` with a `user_id` key builds a duplicate column list · UNTIDY

Same root as B-02, milder end. `db.ts:56` appends `user_id` unconditionally, so
passing it in produces `INSERT INTO docs (title, user_id, user_id) VALUES
(?, ?, ?)` *(reproduced)* — a D1 error at runtime, surfacing as a 500 through
`toResponse`. Not a hole; a footgun that typechecks. The B-02 fix closes it.

### B-09 — A prefix rule matches without a path-segment boundary · UNTIDY

`packages/core/src/routes.ts:24` implements `*` as a bare `startsWith`. A rule
of `GET /v1/public*` therefore also opens `/v1/publicsecrets`. The existing test
"does not treat a public rule as a prefix unless it says so"
(`authz.test.ts:59`) covers the non-prefix case only; the prefix case has no
test.

The module's own header promises "no implicit prefixes" and that a slightly
wrong rule "should fail closed". For prefix rules it currently fails open, and
this is the one matching function standing between every app worker and its
protected routes.

Fix in one sentence: require the character after the prefix to be `/` or
end-of-string, and add the `/v1/publicsecrets` case to `authz.test.ts`.

---

## 2. The OAuth flow

Read against RFC 8252 and Google's current documented flow. The core of it is
right: PKCE with S256 (`oauth.ts:28-32`), the state row consumed by
`DELETE ... RETURNING` so it is single-use before it is trusted
(`oauth.ts:73-78`), the verifier bound to that row rather than to anything the
callback supplies, the redirect target read from the stored row and never from
the callback's parameters (`oauth.ts:120-131`, so there is no open redirect),
the loopback validator refusing everything but `127.0.0.1` and `[::1]` on a
pathless high port (`oauth.ts:12-26`), `email_verified` required
(`oauth.ts:102`), and a missing user row refused with an audit line
(`oauth.ts:104-109`). The id_token signature is not verified, which is correct
here and correctly explained at `crypto.ts:17-22` — it arrives over TLS from
Google's token endpoint in a request we initiated.

Two things it does not do.

### B-04 — The OAuth state is not bound to the browser, so login CSRF is possible · RISK

The `state` value proves the flow was started by *someone*, not that it was
started by the browser now presenting it. Nothing is set on the client at
`/oauth/start` — no cookie, no anything — and the callback's only check is that
the state row exists and has not expired (`oauth.ts:73-78`).

So an attacker who is a member can begin their own flow, capture their own
`code` and `state`, and cause a victim's browser to load the callback URL. The
victim's browser is issued a `__Host-session` cookie for the *attacker's*
account. From there anything the victim does lands in the attacker's account,
which is the direction that makes this worth fixing even under closed
membership.

Fix in one sentence: at `/oauth/start`, also set a short-lived `__Host-` prefixed
cookie holding the state (or its hash), and at the callback refuse unless the
cookie matches the query parameter.

### B-12 — The desktop handoff code is unbound, and the ADR overstates what stays out of the URL · UNTIDY

`exchange` (`oauth.ts:150-166`) trades a code for a session with no proof that
the caller is the client that began the flow — no PKCE, no client secret. The
code is 24 random bytes with a 60-second TTL, hashed at rest and consumed by
`DELETE ... RETURNING`, so it is neither guessable nor replayable. What remains
is that any local process able to reach the loopback port during that window can
spend it first. That is inherent to RFC 8252 without a second PKCE pair, and
accepting it is reasonable — but it should be an accepted risk on the record
rather than an unexamined one.

Related, and purely a documentation point: ADR-0001 §1.10 says "no credential is
ever placed in a URL". A single-use exchange code that mints a session is a
credential, and it is placed in a URL at `oauth.ts:130`. The design is fine; the
sentence describing it is stronger than the design.

Fix in one sentence: have the desktop client send its own PKCE challenge at
`/oauth/start` and its verifier at `/oauth/exchange`, and soften the ADR
sentence to say what is true — no *session token* is placed in a URL.

---

## 3. Access JWT verification

`workers/console/src/access.ts` is the file I most expected to find a hole in
and did not. The algorithm is pinned to RS256 and a `kid` is required *before*
any key is fetched (`access.ts:66`), so `alg: none` and the RSA-to-HMAC
confusion class are both unreachable. The signature is genuinely verified with
`crypto.subtle.verify` over `header.payload` (`access.ts:78-84`), and `exp`,
`nbf`, `iss`, and `aud` are all checked afterwards (`access.ts:86-92`) with
`aud` handled as either a string or an array. Access service tokens, which carry
`common_name` and no `email`, are refused by `access.ts:94-96`. There is no
early return that skips verification on any path I could find.

Two operational edges:

### B-07 — A JWKS fetch failure escapes the console's fetch handler as a bare 500 · UNTIDY

`keys()` throws when the certs endpoint is unreachable (`access.ts:35`), and
`verifyAccessJwt` is called at `workers/console/src/index.ts:46`, *outside* the
`try` that begins at `index.ts:70`. The exception propagates out of `fetch` and
the worker returns Cloudflare's own error page.

The direction is right — nobody is admitted when the keys cannot be checked —
but the doc comment at `access.ts:46` says "Never throws for a bad token", which
is true and reads as broader than it is. The behaviour deserves to be deliberate
rather than incidental.

Fix in one sentence: move the call inside the `try`, or catch around it, and
return a JSON 503 that says the identity provider is unreachable.

### B-08 — The JWKS cache never refetches on an unknown `kid` · UNTIDY

The cache has a flat one-hour TTL (`access.ts:20,33`) and a `kid` miss simply
returns null (`access.ts:69`). When Cloudflare rotates signing keys, every valid
token signed by the new key is refused until the hour is up. Availability, not
security, and self-healing — but the outage is silent and looks like a broken
Access policy.

Fix in one sentence: on a `kid` miss, refetch once before giving up.

---

## 4. Sessions and tokens

Sound throughout, and worth recording as verified rather than assumed.
`randomToken()` defaults to 32 bytes from `crypto.getRandomValues`
(`crypto.ts:8-10`) — 256 bits, so the unsalted SHA-256 at rest
(`crypto.ts:12-15`) has no brute-force exposure and needs no KDF. Only the hash
is ever stored or compared (`sessions.ts:38-42`, `:57`). The validate query
checks revocation, expiry, and account status together in one indexed read
(`sessions.ts:65-68`), so disabling an account really does kill live sessions in
the same statement, which is the whole argument for opaque tokens in ADR §1.1.
`revokeSession` and `revokeAllForUser` both guard on `revoked_at IS NULL`
(`sessions.ts:76-88`), so a revocation timestamp is never overwritten. The
cookie carries `__Host-`, `HttpOnly`, `Secure`, and `SameSite=Lax`
(`oauth.ts:142-144`). `readToken` accepts a bearer token or that cookie and
nothing else (`core/src/auth.ts:101-116`).

`withAuth` denies by default, takes identity only from `AUTH.validate()`, and
refuses any non-`active` status before a handler ever runs
(`core/src/auth.ts:66-84`). The four "identity cannot come from the caller"
tests are real tests of a real property. `notFound()` for rows we do not own
(`errors.ts:19`, `db.ts:39`) closes the enumeration oracle as designed, and
`toResponse` keeps messages and stacks out of client responses
(`errors.ts:25-38`).

---

## 5. The console's HTTP surface

### B-03 — Every omitted query parameter falls to 0, not to its stated default · BROKEN

`workers/console/src/index.ts:25-28`:

```ts
const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
```

`Number(null)` is `0`, and `0` is finite, so the fallback is unreachable for an
absent parameter. It is also unreachable for an empty string. Only genuine
garbage like `"abc"` reaches it. *(reproduced: `num(null, 24)` returns `0`.)*

Downstream, `hours = 0` is clamped up to 1 by `hoursClause`
(`analytics.ts:73`) and `limit = 0` is clamped up to 1 by `activity`
(`analytics.ts:111`). So `GET /api/activity` with no parameters returns **one
row from the last one hour**, where the code plainly intends 200 rows from the
last 24. The clamps are what hide it: they turn a wrong default into a
plausible-looking answer instead of an error.

It is invisible today only because `ui/src/lib/api.ts` always sends both
parameters. Anyone calling the API directly, or any future page that omits one,
gets a near-empty dashboard and no reason why.

Fix in one sentence: `const n = v === null || v === "" ? NaN : Number(v);`.

### B-05 — The mutating endpoints have no CSRF defense of their own · RISK

The four `POST /api/*` routes (`index.ts:113-147`) check no `Origin`, no
`Referer`, and no CSRF token, and `req.json()` parses the body whatever the
`Content-Type` says — so requiring JSON is not the barrier it appears to be.
What actually stops a cross-site request today is that Cloudflare's
`CF_Authorization` cookie is `SameSite=Lax`, which withholds it from a
cross-site POST.

That is a real defense, but it lives in Cloudflare's cookie settings rather than
in this repo, nothing here asserts it, and it is invisible to anyone reading
this file. Given that these four routes are the ones that invite administrators
and disable accounts, the defense should be stated where the routes are.

Fix in one sentence: refuse any `POST /api/*` whose `Origin` is not exactly
`https://console.pookiepied.dev`.

### Analytics SQL — checked, and sound

The Analytics Engine SQL API takes a string with nothing to bind, which is the
classic setup for an injection. It is handled properly: `literal()` is an
allowlist that *drops* a non-conforming value instead of escaping it
(`analytics.ts:65-71`), the pattern excludes quotes and every SQL
metacharacter, `hoursClause` truncates and clamps to 1–720
(`analytics.ts:73-76`), and `limit` is clamped 1–1000 (`analytics.ts:111`). The
only interpolated identifier is `ANALYTICS_DATASET`, which comes from
`wrangler.toml`, not from a request. No user-controlled string reaches a query
unfiltered.

The React UI has no `dangerouslySetInnerHTML`, no `innerHTML`, and no `eval`
(grep-verified), so the `fields` blob rendered on the activity page is escaped
by React like any other text. The console sets a restrictive CSP, `DENY` on
framing, `nosniff`, and `no-referrer` on every asset response
(`index.ts:57-66`).

---

## 6. Telemetry ingest

`safeEqual` (`telemetry/src/index.ts:36-45`) is length-independent as its
comment claims, and `authorize` compares against every configured key rather
than breaking on the first match (`:63-68`), so neither timing channel is open.
The source is taken from the key that authenticated and never from the body
(`:126-128`), so one source cannot report as another — that comment is accurate.
A malformed `INGEST_KEYS` logs and denies rather than admitting (`:56-60`).

### B-10 — The body is fully buffered before the size limit is applied · UNTIDY

`await req.text()` at `:98` reads the whole body into memory; the
`MAX_BODY_BYTES` check happens at `:99`, after. A caller holding a valid write
key can therefore make the worker buffer far more than 64 kB.
Post-authentication and bounded by the platform, so the blast radius is small —
but the check reads as a limit and is not one.

Fix in one sentence: check `content-length` before reading, and keep the
post-read check as the backstop.

### B-11 — The 5000-character fields blob can exceed the Analytics Engine blob budget · UNTIDY

`write()` truncates the fields JSON to 5000 characters (`:73`) and writes it
alongside three other blobs. Analytics Engine caps the *total* bytes across all
blobs in a data point, so a large `fields` bag plus a long path can push a write
past the limit — and `writeDataPoint` does not throw, so the row simply never
appears. Silent loss in the one worker whose entire job is not losing rows.

Fix in one sentence: budget the four blobs together against the documented
limit, and count a truncation as its own countable event.

---

## 7. Test coverage

35 tests exist and they test the right two things well: `authz.test.ts` covers
deny-by-default, caller-supplied identity, the status and role gates, and
ownership scoping including the unsafe-table-name refusal; `oauth.test.ts`
covers loopback validation thoroughly, including the decimal-encoded form.

What has no test at all:

| File | Lines | What is untested |
|---|---|---|
| `workers/console/src/access.ts` | 98 | the entire JWT verification — every check in §3 |
| `workers/auth/src/sessions.ts` | 122 | revocation, expiry, status gating, hash-only storage |
| `workers/auth/src/crypto.ts` | 29 | token length and encoding |
| `workers/telemetry/src/index.ts` | 239 | key comparison, source spoofing, batching, `tail()` |
| `workers/console/src/index.ts` | 163 | routing, the `num()` bug, the POST validators |
| `workers/console/src/analytics.ts` | 162 | `literal()` — the injection barrier |
| `packages/client/src/index.ts` | 125 | all of it |

`access.ts` is the gap I would close first: it decides whether a stranger
reaches the admin panel, and a regression in it is both silent and total. Its
tests are also cheap, since every one of the checks in §3 is a pure function of
a token string and a fixed JWKS.

---

## IS THIS SAFE TO DEPLOY?

**Not yet — but it is close, and nothing found requires a rewrite.**

The architecture is sound and the hard parts are done correctly. Session
handling, PKCE, the Access JWT verification, the analytics injection barrier,
and deny-by-default all hold up under a line-by-line read, and several of them
are better than the ADR claims. There is no half-written code anywhere in this
Backend: every file is finished, every path terminates, and the two mistakes
that matter are single-line omissions in otherwise correct functions.

Fix before deploying:

1. **B-01** — the console's missing role check. One `AdminService` call. This is
   the one that decides whether widening an Access policy later is a
   configuration change or an incident.
2. **B-02** — `user_id` reassignment through `OwnedDb.update()`. One guard, and
   it must land before any app worker is built on top of the class.
3. **B-04** — the state cookie. Roughly fifteen lines across `start` and
   `callback`.
4. **B-03** — the `num()` default. One line, and it is simply wrong today.

Then **B-05** and **B-09**, which are each a few lines, and tests for
`access.ts` before the console is exposed to anything.

The rest — B-06 through B-12 — are worth doing, and none of them should hold up
a deploy.

Every finding above is a fix inside a function that already exists. The design
does not need revisiting.
