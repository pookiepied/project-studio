# Decisions

34 ADRs. Why a rule exists, when the answer was not obvious.

## Why they are numbered and not renamed

**Code cites these by number** — `ADR 0019`, `ADR 0029` — in comments across
`src/` and `tests/`. Never by path. That is deliberate: files can move, and they
have (this folder was `STUDIO HARNESS/docs/decisions/` until 2026-08-15) without
breaking a single reference.

So the *files* stay numbered and append-only. Renumbering them into domain
order would invalidate every citation in the codebase to fix a problem —
findability — that an index solves for free. **This page is that index.**

A superseded ADR keeps its text and gains a status line pointing forward. The
wrong answer, and why we believed it, is the useful part.

## By domain

### Boundaries and structure
| | |
|---|---|
| [0001](0001-harness-boundaries.md) | Harness boundaries |
| [0013](0013-execution-substrate.md) | Execution substrate |
| [0014](0014-where-things-live.md) | Where things live |
| [0034](0034-modular-monolith-exception.md) | Modular-monolith exception — **disputed**, see below |

### Storage
| | |
|---|---|
| [0010](0010-application-owned-database.md) | Application-owned database — why `studio.db` is separate from `flue.db` |
| [0020](0020-one-table-for-effects.md) | One table for effects |

### Identity, auth, and credentials
| | |
|---|---|
| [0007](0007-secure-credential-storage.md) | Secure credential storage — secrets in the OS keychain, never in a database |
| [0008](0008-harness-owned-sign-in.md) | Harness-owned sign-in |
| [0028](0028-harness-client-admission-and-local-access.md) | Harness client admission and local access |
| [0030](0030-local-execution-identity-and-deferred-multi-user.md) | Local execution identity; multi-user deferred |

### Permissions, trust, and containment
| | |
|---|---|
| [0012](0012-permission-and-containment.md) | Permission and containment — the kernel decides, never executes, never prompts |
| [0015](0015-approval-scope.md) | Approval scope |
| [0018](0018-trust-and-modes.md) | Trust and modes |
| [0021](0021-a-grant-belongs-to-a-project.md) | A grant belongs to a project |
| [0024](0024-capabilities-are-on-and-the-list-is-honest.md) | Capabilities are on, and the list is honest |

### Tools and execution
| | |
|---|---|
| [0016](0016-undo-history.md) | Undo history |
| [0017](0017-call-bounds.md) | Call bounds |
| [0019](0019-running-a-chosen-program.md) | Running a chosen program — `execute` as uncontained by consent |

### Network
| | |
|---|---|
| [0022](0022-a-network-effect-is-a-destination.md) | A network effect is a destination |
| [0023](0023-web-search-and-fetch-providers.md) | Web search and fetch providers |
| [0025](0025-who-wrote-it-is-one-question.md) | Who wrote it is one question |
| [0026](0026-a-redirect-is-written-by-the-far-end.md) | A redirect is written by the far end |
| [0027](0027-a-failed-post-is-the-answer.md) | A failed POST is the answer |

### Models and providers
| | |
|---|---|
| [0003](0003-context-optimization.md) | Context optimization |
| [0005](0005-model-provider-composition.md) | Model-provider composition |
| [0009](0009-local-byok-providers.md) | Local BYOK providers |

### Gateway
| | |
|---|---|
| [0002](0002-two-gateway-model.md) | Two-gateway model |
| [0006](0006-studio-gateway-integration.md) | Studio Gateway integration |
| [0031](0031-harness-gateway-contract-is-not-current-worker-contract.md) | The Harness/Gateway contract is not the current Worker contract |

### MCP
| | |
|---|---|
| [0029](0029-mcp-session-tool-membership.md) | MCP session tool membership — amended by meta-task #56 |

### Errors, observability, and recovery
| | |
|---|---|
| [0004](0004-observability.md) | Observability |
| [0011](0011-shared-error-contract.md) | Shared error contract |
| [0032](0032-fail-safe-runtime-recovery.md) | Fail-safe runtime recovery |
| [0033](0033-execution-identity-and-operation-correlation.md) | Execution identity and operation correlation |

## ADR 0034 is disputed

It records a narrowly scoped exception letting `StudioRuntime` keep its public
repository bags and the SQLite handle stay public, so the 008.3 gate could be
recorded closed.

The exception was taken *instead of* the fix, and the tests written alongside it
asserted the violations rather than their absence. Meta-task issues #4–#8 and
#19–#24 close the gate properly. When they land, 0034 should be **superseded by
a new ADR** stating what actually holds — not edited to look as though it always
said that.

## Adding one

Next number, never reuse. Format is in `../README.md` §5. Add it to the right
domain table above, and cite it from code by number.
