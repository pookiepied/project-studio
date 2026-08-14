# ADR 0031 - Harness Gateway Contract Is Not The Current Worker Contract

**Status:** accepted boundary

**Amends:** ADR 0002 and ADR 0006 for the current repository state.

## Decision

The Harness Studio Cloud adapter and `STUDIO Gateway/` are separate protocol
surfaces until a cross-project contract is implemented and tested. The Harness
adapter's typed SSE events, camelCase request model, and Studio session token
are not treated as compatible with the Worker's OpenAI-compatible routes,
snake_case expectations, and `sk-gw_*` keys.

The current Worker is therefore not a supported production backend for the
Harness adapter. Local Harness tests may use the custom mock Gateway contract;
Worker deployment remains independently authenticated and OpenAI-compatible.
No code may silently translate or reuse one bearer as the other.

## Deferred Work

Choose one authoritative public/service-binding contract, then add a real
cross-project test covering authentication, request fields, model selection,
stream events, tool continuation, media, and error semantics. Until then,
Gateway/Harness integration is explicitly experimental rather than a claimed
end-to-end product path.
