# MCP discovery update

Discovery now separates browsing, loading and inspection. Eight is the default
browse page size, not a loading cap. Native and third-party MCP use the same rules.

```json
{"server":"mcp:unreal","query":"material","limit":50}
```

```json
{"action":"load","server":"mcp:unreal","tools":["create_material","assign_material"]}
```

```json
{"action":"load","server":"mcp:studio-browser","tools":"all"}
```

```json
{"action":"inspect","server":"mcp:unreal","tools":["create_material"]}
```

No arguments lists enabled servers. Browse results carry a next cursor when
more results remain. Keep the server and query when continuing. Inspection
does not load tools. Loading confirms names without repeating schemas; the
tools become callable from the next model step. The old `scope` API is removed;
the client still reads saved transcripts that used it.

## Changed files

- `STUDIO HARNESS/src/tools/discover/discover.ts`: explicit actions, strict
  validation, search, stable paging, size preflight and observation stages.
- `STUDIO HARNESS/src/tools/discover/index.ts`: registration contract wording.
- `STUDIO HARNESS/src/application/studio-runtime.ts`: supplies the current gate's
  MCP registrations for the cumulative preflight budget.
- Harness context prompt/inventory, deterministic model adapter, customization
  tool output and bundled customization skill: use the new calling rules.
- Harness discovery/inventory unit tests and MCP runtime integration tests:
  exercise selection, inspection, next-step loading and conversation isolation.
- Client `NativeToolDetails.tsx`, `toolResult.ts` and their regression tests:
  read the new receipts, hide schemas/instructions and report missing servers.
- Root README, ADR 0048, observability contract and coverage tracker: describe
  the interface, bounds, parent propagation and remaining limits.

## Verification

Before this change, the three focused harness files passed 52 tests. They now
pass 88. The client report tests pass 10 tests, including three new cases that
failed against the previous implementation. The full harness check passed
typecheck, lint, build and 2,548 tests (28 skipped), taking about 23 minutes.
The full client check passed typecheck, lint and 1,571 tests, up from the 1,568
measured in the preceding terminology change. Both suites ran sequentially.
The rules' two-minute harness estimate did not match this machine's run; an
earlier finalization attempt was interrupted for the inspection-bound fix,
then the final run completed successfully.

Negative controls were restored after their expected failures:

- Changed the default page from eight to nine: the pagination test failed.
- Bypassed disabled-server selection: list, load and inspect refusal tests failed.
- Disabled the cumulative schema-size guard: single-call and cross-server budget
  tests failed.
- Disabled the incremental inspection guard: the test detected serialization
  continuing after the result budget was exceeded.

The shipped browser and computer catalogs both fit the loading budget. Their
serialized source definitions measured about 14 KiB each, before namespace
prefixes; tests also load the real 24-tool and 26-tool catalogs.

## Bounds and limits

The implementation chooses browse pages of 1–100 summaries, queries of at most
200 characters, results of at most 64 KiB and a 512 KiB load preflight budget for
current MCP registrations plus the selection. These are resource bounds, not
permission rules or provider token counts. Existing catalog replacement and
process-local conversation adoption behavior remain unchanged. A later catalog
refresh can change definition size; the preflight is not a permanent context-size
guarantee. Unexpected registration exceptions are preserved, without claiming a
transactional rollback. Real desktop/browser actions were not needed to test
catalog loading.

The tool keeps `native/discover` identity and the existing gate. Child operations
record fixed stages and operational counts only. Tool names, query text, cursors,
descriptions and schemas remain in gated tool content. No new collection switch,
external request, retry authority or permission concept was added.

Branch: `codex/clarify-tool-terminology`. One local review commit; no commit on
`main`, push or merge.
