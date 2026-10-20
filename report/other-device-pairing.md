# Other-device pairing repair

The settings button only read the active code, QR codes carried no pairing
credential, and the pane did not refresh consumed or expired codes. Separately,
the native device store restored records without their revocation channels;
authentication required those channels and refused every restored browser.

## Changes

- `STUDIO/src/platform/tauri/nativeMenus.ts`, `STUDIO/src/shell/AppShell.tsx`
  and the menu description: restrict global custom context/selection menus and
  webview shortcut suppression to desktop windows. Browser menus remain available.
- `STUDIO/src/platform/remote-access.ts`, the native command in `lib.rs`,
  `remote/pairing.rs` and the settings hook: distinguish reads from explicit
  renewal. Reads retain valid codes; renewal invalidates the previous code.
  The native operation is atomic. The pane polls codes, prevents overlapping
  renewal requests and displays errors.
- `DevicesPane.tsx` and `PairingGate.tsx`: QR links carry a single-use code in
  the URL fragment. The browser removes it before requests, submits once even
  with React effect replay, verifies the cookie and keeps manual entry available
  if pairing fails. Existing paired browsers do not consume another code.
- `remote/devices.rs`: recreate channels for restored devices. Serialize record
  and index mutations. Confirm pairing only after durable indexing; confirm
  removal only after durable index exclusion. Rename writes before changing its
  displayed value. A failed removal remains visible for retry. Record deletion
  after durable exclusion remains best effort; the orphan cannot authenticate.
- `remote/gate.rs`: return pairing state/results with `no-store`, avoid duplicate
  pairing entries for existing valid cookies, and name browsers by browser/OS.
- `PairingGate.tsx`: periodically check admitted browsers and check on focus;
  revocation returns them to pairing. This UI can lag by four seconds or browser
  background throttling; the native gate refuses requests and terminates streams
  independently of this UI check.

The paired identity is a browser cookie/profile on one hostname, not physical
hardware, a tab or a hardware fingerprint. Tabs share their cookie. Different
browser profiles, private sessions or address aliases may need separate pairing.
Browser/OS naming is best effort and existing user names are preserved.

## Verification

Baseline from the preceding gate: 2,567 harness tests and 1,588 client tests.
Focused client regression run passed 34 tests. Native library tests passed 154
tests, serially, excluding the existing real-credential-store self-test. Clippy
passed with warnings denied. An earlier parallel native run hit an unrelated
Inspector nonblocking-socket race; that test passed alone and the serial full
native rerun passed.

Negative controls were run and restored:

- Removing the browser suppression guard failed native-menu preservation.
- Dropping the renewal flag failed the native invocation contract assertion.
- Removing code refresh failed the initial/polled code assertions.
- Ignoring the QR fragment failed automatic pairing, URL cleanup and fallback tests.
- Removing restored channels failed real restored-cookie authorization.
- Ignoring failed durable removal failed the refusal assertion.
- Ignoring explicit renewal failed both renewal/invalidation regressions.

Additional regressions cover delayed double clicks, QR/code synchronization,
cookie confirmation failure, invalid QR fallback, manual entry, existing-cookie
deduplication, focus/poll revocation, index-only pairing failure, rename/removal
failure, durable removal despite a failed record delete and browser naming.

The frontend production build and `tauri build --debug --no-bundle` passed.
The latter embeds the updated frontend in `STUDIO/src-tauri/target/debug/studio.exe`.
No running Studio process was replaced or started. Use `start.ps1 -Rebuild` when
restarting development Studio; existing installed binaries need the rebuilt app.
The full harness gate passed typecheck, lint, build and 2,567 tests (28 skipped;
196 test files passed, two skipped), in 1,461.85 seconds. The root command then
passed client typecheck, lint and 1,602 tests across 177 files, in 123.65 seconds.
The complete root `pnpm check` exited zero. The two existing jsdom `scrollTo`
notices remained nonfatal. No dependencies or storage migrations were added.

## Scope and limits

The independent review found the renewal race during implementation; the final
review found no unresolved material defect in the changed paths. This is not
physical phone, firewall, VPN or multi-device hardware testing. The existing
first non-QR state-probe failure still permits an empty shell for static/dev
compatibility; native authentication remains enforced. QR failures remain gated.
Interface selection, mDNS name conflicts and browser secure-context restrictions
retain their existing behavior. No hardware identity is inferred from user-agent
text, and no raw user-agent is persisted.

The explicit user instruction to work on and push `main` takes precedence over
the older branch policy in `documentation/rules.md`. Existing untracked
`STUDIO HARNESS/.studio-transcript-patch/` is unrelated and preserved.
