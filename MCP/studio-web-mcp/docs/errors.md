# Errors — basic v1

Current implementation uses **simple `code` + `message`** only (per request).

- `src/errors/codes.ts` — `INVALID_URL`, `RATE_LIMITED`, `SEARCH_FAILED`, `FETCH_FAILED`, etc.
- `src/errors/error.ts` — `StudioError(code, message, status)` with `toResponse() => {code,message}`
- `src/errors/normalize.ts` — `normalizeProviderStatus(status, provider)` + `shouldFallback()`
- `src/errors/response.ts` — `toMcpError(e) => {code,message}` for `isError` payloads

Tool handlers (`src/tools/*/index.ts`) catch and return:

```json
{ "error": { "code": "INVALID_URL", "message": "Hostname not allowed" } }
```

with `isError: true`. Raw provider bodies/stacks never leak.

When you need richer codes/numeric aliases later, expand `codes.ts` and `response.ts` without changing tool contracts.
