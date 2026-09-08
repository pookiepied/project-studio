# Why git cannot read its working directory inside our sandbox

**2026-09-08 · the research round this document answers** [the handover note](git-sandbox-research-handover.md) and continues [the toolchain onboarding brief](toolchain-onboarding-brief.md). Machine: the author's Windows 11, unelevated throughout (measured: `net session` → not elevated; nothing below required elevation). Harness untouched: no edits under `STUDIO HARNESS/src` or `STUDIO/src`, no test-suite runs, no `sandbox:prepare`. Section 9 lists everything this investigation *did* change, and the state it left behind.

**The one-paragraph answer.** Inside the container, git's `getcwd` (`compat/mingw.c` at the installed build's own commit, quoted in §2) resolves the working directory it got from `GetCurrentDirectoryW` through `CreateFileW(cwd, 0, …, FILE_FLAG_BACKUP_SEMANTICS)` and then `GetFinalPathNameByHandleW`, falling back to `GetLongPathNameW`. Whatever the first resolving step asks beyond *traverse* is missing on the ancestor chain, and the `GetLongPathNameW` fallback needs `FILE_LIST_DIRECTORY` (the same 0x1 bit as `FILE_READ_DATA`) on the parent of *every* component — including `C:\` and `C:\Users`, which on this machine carry only the machine-prepared traverse ACE and cannot be extended by an unelevated process. Granting traverse+LIST on the whole chain, drive root included, fixes it: proven by compressing the chain to a single grantable component with `subst`, after which the identical binary, grants and policy answered `fatal: not a git repository` — the good error — instead of dying. The read-extended-attributes bit is *not* needed (measured). `C:\Users\pooki` and below need no elevation (measured); exactly two directories do (measured).

**What shipped, 2026-09-08.** Option A, as recommended: a fourth launcher mode,
`corridor` — `TRAVERSE_ACCESS | FILE_LIST_DIRECTORY`, still non-inheriting,
still `SetFileSecurityW`. `traversal.ts` grants it on the ancestors of every
workspace and `sandbox:prepare` grants it to `ALL APPLICATION PACKAGES` on the
two system-owned ones. Verified by the §5 experiment repeated against the
shipped binary: with traverse only, `fatal: Unable to read current working
directory`; with the corridor entry, the same binary in the same workspace ran
`git init`, `git status` and `git rev-parse --show-toplevel` to completion.
One departure from the memo, for a reason it could not have known: falling
short of the corridor is **not** treated as a shortfall when the ancestor still
holds the old traverse entry, so a machine prepared before this change keeps
working for everything except git rather than losing its shell until someone
re-runs an elevated command. See ADR 0041's amendment.

---

## 1. Corrections to the previous round, first

The handover asked for contradictions *first*. Three of the five known facts needed correcting; none of the conclusions fell, but the details matter for the fix.

**1.1 — Fact 2's quoted error message is only half the story (measured).** There are two *different* failure messages from two *different* die sites, both reaching the same `getcwd`:

```
fatal: Unable to read current working directory: Permission denied     ← git status, git rev-parse
fatal: unable to get current working directory: Permission denied      ← git init
```

Measured: contained `git status`, `git init`, `git rev-parse --show-toplevel` in all three test workspaces, both via `C:\Program Files\Git\cmd\git.exe` and via `C:\Program Files\Git\mingw64\bin\git.exe`. The sources at the installed build's commit 52ca1113d651127f89477a8763f86ab20f645e1d: `setup.c:1986` (`die_errno(_("Unable to read current working directory"))`, in `setup_git_directory_gently`) and `abspath.c:106` (`die_errno("unable to get current working directory")`, in `strbuf_realpath` with `REALPATH_DIE_ON_ERROR`). The previous round quoted the `init` spelling for both.

**1.2 — Fact 4, "the user's home directory needs elevation", is wrong about the home and right about two other directories (measured).** Owners and DACLs, this machine, 2026-09-08:

| Directory | Owner | Grantable unelevated? | Evidence |
|---|---|---|---|
| `C:\` | `NT SERVICE\TrustedInstaller` | **no** | `icacls C:\ /grant …` → `Access is denied`; launcher `grant --mode traverse` → `could not set the permissions of C:\ (error 5)` |
| `C:\Users` | `NT AUTHORITY\SYSTEM` | **no** | same, both tools: `Access is denied` / `(error 5)` |
| `C:\Users\pooki` | `BUILTIN\Administrators` | **yes** | the DACL carries an explicit `POOKIEPIED\pooki:(OI)(CI)(F)`; every icacls grant and launcher grant below this line succeeded |
| everything under it | (inherited `pooki:(F)`) | **yes** | ditto |

So "granting read on the ancestors is refused" was experienced, but the *mechanism* to note for the fix: the refusal is exactly two system-owned directories, `C:\` and `C:\Users`. (The launcher's own 60-second `execFileSync` cap, which `launcher.ts` documents, is the other way a propagating read-grant on a big tree reads as a refusal — not re-measured here; see §10.)

**1.3 — The doc comment at the top of `appcontainer.ts` (and ADR 0041) say "a contained child cannot read `C:\Program Files\nodejs`". On this machine today, it can (measured).** icacls shows `ALL APPLICATION PACKAGES:(OI)(CI)(RX)` explicitly on `C:\Program Files\nodejs`, the launcher's `check --sid S-1-15-2-1 --mode read` answers `granted` there, the in-container probe answers `open-directory: ok / enumerate: ok / open-file: ok`, and node listed 66 entries under `C:/Program Files` from inside the container. The deeper claim — the image is opened with the *launcher's* rights, so no program grant is needed to *run* — remains true and load-bearing: contained `git --version` ran with no program root granted at all, reproducing fact 1. But the "cannot read afterwards" premise no longer holds for anything under `C:\Program Files`, because `C:\Program Files` itself carries inheritable `ALL APPLICATION PACKAGES:(RX)`. Whatever needed that doc comment's trap-slide once, Program Files is not it on this machine today.

**1.4 — A confirmation, not a contradiction, worth keeping.** `traversal.ts`'s story — "a program that resolves its own path calls `realpath`, and on Windows that lstats *every component*" — was reproduced exactly, twice. `node oracle.js` (the script-*file* form, not `-e`) died at baseline with `EPERM … syscall: 'lstat'` on the workspace's *parent* — the first component without any ACE the container's AND-check satisfies — while `node -e` with the same grants ran happily. That is the ADR's own "`node -e` shortcut" warning, reproduced incidentally in this round's own baseline (see §4.4). And after my SID's traverse ACE was added on that parent — the step `ensureTraversable` would have taken, which my mirror had skipped — the very same `node oracle.js` ran to completion, printing successful `realpath` for *every* component from `C:/` down (exit 0). Traverse+read-attributes suffices for the entire realpath walk. Measured, both directions.

---

## 2. What call fails

**Measured:**

- The child's `GIT_TRACE=1 GIT_TRACE_SETUP=1 GIT_TRACE2=1` run of `git status` dies *before any repository work*: it resolves its own executable directory (`trace: resolved executable dir: C:/Program Files/Git/mingw64/bin` — the shim did its whole job), prints the banner, then `usage.c:73 error Unable to read current working directory: Permission denied`, exit 128, 0.019 s. With a pre-made `.git` in the workspace (`ws3repo`, initialized *uncontained* before the runs), `git status` and `rev-parse` die the *same way* — so the failure is in the very first working-directory resolution, not in repo discovery or the upward walk.
- The shim is innocent: the real `C:\Program Files\Git\mingw64\bin\git.exe`, driven directly, fails identically (`fatal: Unable to read current working directory: Permission denied`, exit 128). The shim additionally does not even contain the error string (measured: `grep -c "unable to get current working directory"` → 0 in the shim, 2 in the real binary) — the message is the real git's.
- node, in the *same workspace under the same grants*, resolves the same directory without hurting: `process.cwd()`, `readdirSync('.')`, and — the decisive one — `statSync('C:/Users')` and `realpathSync` of *every* component from `C:/` down, all succeeded. node's realpath walks via repeated `lstat` (the earlier EPERM traceback literally printed `syscall: 'lstat'`), and lstat needs only traverse+READ_ATTRIBUTES. So *stat-class* access is not what git is missing.

**Cited, at this build's exact commit** — `compat/mingw.c`, `mingw_getcwd`, fetched from the built-from commit 52ca1113d651127f89477a8763f86ab20f645e1d (measured: `git version --build-options` → `git version 2.55.0.windows.3`, `built from commit: 52ca1113…`):

```c
char *mingw_getcwd(char *pointer, int len)
{
	wchar_t cwd[MAX_PATH], wpointer[MAX_PATH];
	DWORD ret = GetCurrentDirectoryW(ARRAY_SIZE(cwd), cwd);
	HANDLE hnd;

	if (!ret || ret >= ARRAY_SIZE(cwd)) { /* ENAMETOOLONG / errno */ return NULL; }
	hnd = CreateFileW(cwd, 0,
			  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
			  OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
	if (hnd != INVALID_HANDLE_VALUE) {
		ret = GetFinalPathNameByHandleW(hnd, wpointer, ARRAY_SIZE(wpointer), 0);
		CloseHandle(hnd);
		if (!ret || ret >= ARRAY_SIZE(wpointer)) {
			ret = GetLongPathNameW(cwd, wpointer, ARRAY_SIZE(wpointer));
			if (!ret || ret >= ARRAY_SIZE(wpointer)) { /* errno, return NULL */ }
		}
		if (xwcstoutf(pointer, normalize_ntpath(wpointer), len) < 0) return NULL;
		return pointer;
	}
	if (GetFileAttributesW(cwd) == INVALID_FILE_ATTRIBUTES) { errno = ENOENT; return NULL; }
	/* … returns the raw GetCurrentDirectoryW result, converted */
}
```

**Inferred, but tightly, by elimination** (no syscall trace was possible this round — see §10): if `CreateFileW(cwd, 0, …)` had failed, the very next line, `GetFileAttributesW(cwd)`, needs only read-attributes plus traverse — the *stat-class* access node proved sufficient — and the function would have returned the raw `GetCurrentDirectoryW` string without dying. It died. Therefore `CreateFileW` succeeded, and the failure is in **`GetFinalPathNameByHandleW(hnd, 0)` *and* the `GetLongPathNameW(cwd, …)` fallback, both**. `GetLongPathNameW` is the component-walker: it lists each component's parent to map 8.3/long names, which needs exactly the `FILE_LIST_DIRECTORY` (0x1) bit the traverse grant deliberately omits (`acl.rs` spells the masks out; the absence of 0x1 from `TRAVERSE_ACCESS` is documented in this repo's own code). Which of the two resolvers fails *first*, and why `GetFinalPathNameByHandleW` — nominally handle-only — fails inside an AppContainer: **unverified**. There is no Process Monitor (not installed; needs elevation) and no cdb (measured absent) on this machine, and the shell was not elevated. One honesty note: a `subst:`ed drive may itself take a different code path through this function's neighborhood (Git for Windows has historic SUBST handling there), so the subst experiment in §5 is corroborating rather than exclusively probative.

The witness that ties the failure to *this function*: both die sites call `strbuf_getcwd` → `getcwd`. The `getcwd` → `mingw_getcwd` alias lives in the compatibility header, which was not fetched this round — the connection through the portability layer is **inferred**, not quoted; what is *quoted* is that these are the only two die-sites for these messages, and the only working-directory→filesystem implementation in the binary that carries them.

---

## 3. Which object is denied, and which right

Instrument: the shipped probe, self-nested so it *runs inside the container* — `studio-contain.exe run --sid <SID> --cwd <WS> -- studio-contain.exe probe --path <P>` — which asks the kernel four questions (`open-directory` = `CreateFileW(…, FILE_LIST_DIRECTORY|FILE_READ_ATTRIBUTES, FILE_FLAG_BACKUP_SEMANTICS)`; `enumerate` = `FindFirstFileW(P\*)`; `open-file` = `CreateFileW(…, FILE_GENERIC_READ, …)`; `create-file` = `CreateFileW(…, FILE_GENERIC_WRITE, CREATE_ALWAYS)`) and prints one `ok`/`error N` line each.

**Baseline** (machine-prepared traverse on the whole chain — see §4.1 — plus write on the workspace only):

| Probe target | open-directory | enumerate | open-file | create-file |
|---|---|---|---|---|
| `C:\` … `…\Temp` (every ancestor) | error 5 | error 5 | error 5 | error 5 |
| `…\Temp\git-sandbox-findings` (ungranted, between) | error 5 | error 5 | error 5 | error 5 |
| the granted workspaces | ok | ok | ok | **ok** |
| `C:\Program Files`, `C:\Program Files\Git\cmd` | ok | ok | ok | error 5 |

So at baseline: *every* ancestor answers error 5 to everything the probe asks, including plain `open-directory`, while Program Files answers to everything but create — the inheritable `ALL APPLICATION PACKAGES:(RX)` at work. The granted workspace answers to everything. (The container's *own* package directories under `%LOCALAPPDATA%\Packages\studio-gitfindings\AC\…` answer error 5 to direct probes even though the oracle showed `TMP` resolving there and the process wrote through it — AppContainer redirection, mechanism **unverified** here.)

**After granting traverse+LIST (the icacls-letters mask `(Rc,S,RD,X,RA)`) on everything from `pooki` down** (see §5):

| Probe target | open-directory | enumerate | open-file |
|---|---|---|---|
| `pooki` and below | **ok** | **ok** | error 5 |
| `C:\Users`, `C:\` (not grantable unelevated; untouched) | error 5 | error 5 | error 5 |

Two things this table nails:

- The 0x1 (LIST) bit is what `open-directory` and `enumerate` were missing — granting it flips both, immediately, on exactly the directories that got it. That is the *right* identified: `FILE_LIST_DIRECTORY` — which the probe's `open-file` then shows is still short the `FILE_READ_EA` (0x8) bit, because `FILE_GENERIC_READ` demands it too; icacls renders my `(Rc,S,REA,RD,X,RA)` grant as `(RX)` for the same reason.
- The residual, after the deepest five directories were upgraded: exactly `C:\Users` and `C:\`. That is the *object* named. Combined with the die: the code path needs something at least as generous as traverse+LIST at the drive root and `C:\Users`.

---

## 4. Is traverse the gap? Yes — three independent measurements

**4.1 The machine's prepared state was the control.** Before any grant of mine, the whole chain already carried explicit, non-inheriting `ALL APPLICATION PACKAGES:(Rc,S,X,RA)` — precisely the launcher's `TRAVERSE_ACCESS` mask, i.e. someone ran the traverse-flavored machine-wide preparation here in the past — and the launcher's own `check --sid S-1-15-2-1 --mode traverse` answers `granted` for `C:\`, `C:\Users`, `pooki` and `Temp`. The failure exists *with* traverse-everywhere. Adding LIST on `pooki`-and-below did *not* fix it (§3). Ergo traverse is not sufficient; the only difference between the working (subst) and failing (C:) configurations, §5, is listability of the chain. That is the gap, by subtraction.

**4.2 The probe differential (§3).** One bit — (RD) — added to the traverse mask flipped `open-directory` and `enumerate` from error 5 to ok, on every directory that got it, in the same session, with the same processes. The bit the traverse grant deliberately does not carry is the bit the failure needs.

**4.3 The negatives, which fence the claim.**

- *Extended attributes are not needed:* after upgrading to `(Rc,S,REA,RD,X,RA)`, I downgraded my SID's ACE to `(Rc,S,RD,X,RA)` — no EA — while the co-trustee `ALL APPLICATION PACKAGES` held `(RX)` (which *includes* 0x8). Under the AppContainer AND-check, the effective mask is the intersection: no 0x8. git still worked on that configuration (subst chain). So traverse+LIST, without EA, suffices. **Measured.**
- *The `internetClient` capability carries nothing extra here:* `run … --capability internetClient` versus without, probed against `C:\` and `C:\Users` — identical answers, error 5 everywhere — and contained git with the capability died the same way. The drive-root ACEs carry compound capability SIDs (`S-1-15-3-65536-…:(S,RD,X,RA)` on `C:\`, another compound on `C:\Users`); whichever capabilities those are, this container's set doesn't hold them. **Measured; the SID identities themselves: unverified.**
- *A second drive offers no escape hatch:* `D:\` exists (SteamLibrary et al.) but is owned by `BUILTIN\Administrators` and refused the unelevated icacls grant — `Access is denied` — so its DACL could not be touched, let alone upgraded. **Measured.**

**4.4 Aside — the same gap, another victim.** In the *first*, faulty, baseline (before the workspace-parent traverse grants — my miss, not the harness's), `node oracle.js` (script-file form) died with `EPERM … lstat` on the first ungranted component while `node -e` sailed through. This is precisely the `sandbox-appcontainer.test.ts` "ten green tests all taking the `-e` shortcut" failure the ADR 0041 already warns about, reproduced incidentally. It answers to *traverse* (fixed by the step `ensureTraversable` already takes); do not confuse it with git's LIST gap.

---

## 5. The smallest grant that makes `git status` work

The decisive experiment: **compress the ancestor chain to a single, grantable component.** `subst X: C:\Users\pooki\AppData\Local\Temp\git-sandbox-findings` — a user-scoped, session-local drive — and put a workspace directly under it, `X:\ws1x`, granted `write` like any other. The *entire* absolute path of the cwd became `X:\ws1x`: one component above the workspace, and that component's DACL (the subst target's, where my earlier grants had left `ALL APPLICATION PACKAGES:(RX)` — including, crucially, the 0x1 bit). Same binary, same SID, same policy. Result:

```
$ LX run --sid $SID --cwd X:\ws1x -- "C:\Program Files\Git\cmd\git.exe" status
fatal: not a git repository (or any of the parent directories): .git
exit=128                                    ← the *good* failure: getcwd worked
```

Every later arm on that chain — my SID's ACE rewritten to `(Rc,S,X,RA)`, then `(Rc,S,REA,RD,X,RA)`, then `(Rc,S,RD,X,RA)` — kept the good failure, with the AAP `(RX)` ACE co-granting throughout (so that final row is the AND-intersection proof of §4.3, not a single-SID reversal; the muddier variant of the reversal control is disclosed here rather than hidden).

**The answer, with the candidates tested individually:**

| # | Candidate grant (ancestors) | Elevated needed? | git? | Provenance |
|---|---|---|---|---|
| 0 | traverse only, whole chain (today's prepared state) | — (already there) | fails, both messages, every workspace | §2, §3 baseline |
| 1 | + LIST (`(Rc,S,RD,X,RA)`) on `pooki`, `AppData`, `Local`, `Temp`, the WS-parent — *not* on `C:\Users`/`C:\` | **no** — icacls unelevated, instant | **still fails** | §3 |
| 2 | + the same on `C:\Users` and `C:\` | **yes** — icacls *and* the launcher both refuse: `Access is denied` / `(error 5)` | **untestable unelevated on this machine** | §3 |
| 3 | traverse+LIST on the *whole* chain via a compressed one-component chain (`subst X:`) | **no** (the component is the user's) | **works** — the good error, then real repo operations | §5 |
| 4 | the launcher's existing `read`-mode instead of traverse (mask ≡ `RX` = traverse+LIST+EA, inheritable `(OI)(CI)`, propagates) | depends on the directory (no for user-owned, yes for the two system ones) | python311 arm: grant 15 s, revoke 11 s, then contained python with its program root: `cwd`+`listdir`+stdlib imports, exit 0 | §5 note |
| 5 | `internetClient` capability | no | no effect | §4.3 |

So: **the smallest grant that works is the existing traverse ACE plus one bit — `FILE_LIST_DIRECTORY` — applied this-object-only, non-inheriting, on every ancestor of the workspace *including the drive root*.** In icacls letters: `(Rc,S,RD,X,RA)`. In the launcher's vocabulary: a fourth mode, or — cheaper to ship — the eighth bit of difference between today's `TRAVERSE_ACCESS` and `READ_ACCESS` in `acl.rs`, minus the EA the read-mode adds and the propagation the read-mode pays.

**The cost, measured, of the realistic fix shapes — the judgement is deliberately left open:**

- **Option A — extend the traverse grant by the LIST bit (new launcher mode, this-only, `SetFileSecurityW`).** Adds one ACE per ancestor per workspace, exactly the accumulation pattern the harness already accepts and ledgers for traverse; no propagation walk, so no 60-second timeouts; the *same* release machinery already revokes it. The machine-wide preparation — needed only for `C:\` and `C:\Users`, and on this machine only because their owners are TrustedInstaller/SYSTEM — would have to be re-run once, elevated, for the extended mask (the existing `(Rc,S,X,RA)` fossils on exactly those directories are the receipt of the previous, traverse-only run). This is what I would ship, because it changes one mask, one `propagates`/`inheritance` bit, and nothing about the ledger, the probe, or the release story.
- **Option B — switch the ancestor grants to the existing `read` mode.** No code at all beyond the mode passed. Costs: the `(OI)(CI)` inheritance pushes the ACE to every descendant (a far larger footprint on the user's disk than today's corridor) and the grant/revoke becomes a tree walk — 15 s/11 s on the ~10k-file python311 tree; the home, orders of magnitude bigger, is exactly the case `launcher.ts` documents as having already eaten the 60 s `execFileSync` cap once. Extrapolation, not measurement, for the home; noted as such.
- **Option C — `subst`-compress the workspace chain.** Works, measured, zero new DACL-approach privileges, but it is a session-scoped drive mapping owned by the caller, not by the harness. A footnote, not a recommendation.

One more measured asymmetry worth shipping with the fix: with traverse+LIST everywhere, **Program Files needed nothing** — `C:\Program Files\Git\cmd`, `…\mingw64\bin`, `…\share\git`, `…\libexec\git-core`, `…\usr\bin` all answer `granted` to `check --sid S-1-15-2-1 --mode read` before any grant of mine. So the fix does not reopen the elevation question the program-roots doctrine worries about; it stays two directories, once.

---

## 6. Is it git-only?

**No — but in two different senses, both measured.**

**Among native (non-msys) programs, everything works — with the grants the harness already means to give, plus, for git, the LIST bit.**

| Program | Kind | Needs beyond the WS grant | Result in-container |
|---|---|---|---|
| `node -e` | native, no runtime files | — | worked even in the *faulty* baseline (no main-module resolution) |
| `node oracle.js` (script file) | native | traverse on the WS-parent (what `ensureTraversable` grants) | EPERM lstat at the missed-baseline; exit 0 once that one ACE existed |
| `rg --files` (shipped 14.1.1) | native, reads only its targets | — | exit 0, listed the workspace, always |
| `python` 3.11 (user-profile install) | native, reads its stdlib | read on its own program root (propagating grant, 15 s) | exit 0: `os.getcwd()`, `os.listdir('.')`, stdlib imports |
| `git` (both the shim and the real binary) | native | + LIST on the ancestor chain *including the drive root* | dies unelevated-grants-only; works under the compressed chain |

So "git is special" survives only as: *git is the one program the shell resolves that cannot work on the traverse-only corridor this machine happens to have*. Every other native program's needs were already met.

**Among msys-2.0.dll programs, nothing works, and it is not the filesystem grants this memo covers.** Contained `C:\Program Files\Git\usr\bin\sleep.exe 0.1` and `C:\Program Files\Git\bin\bash.exe -c pwd` exit **127, silently** — no stdout, no stderr — at baseline, after the traverse grants, *and* after full read+execute+LIST to `pooki`-inclusive; even Git for Windows' own `strace.exe` dies inside the container (segfault, exit 139). The harness's own comment in `tools/shell/index.ts` — "Git's `bash.exe` cannot run inside a container" — is thereby confirmed and strengthened: it is not bash, it is the entire msys-2.0.dll family, dying before their `main` runs. The cause — what `msys-2.0.dll` reads first, which right it lacks — is **unverified**: no trace, no cdb, no elevation, and its failure prints nothing. The harness already routes around this (PowerShell/`cmd` interpreters), which is presumably why nobody had to know.

---

## 7. What other harnesses do

A background research pass (web, 2026-09-08, primary sources preferred; its full report with per-claim citations is what this section condenses) — **read as documentation, not as behavior measured on this machine, except where noted**:

- **Claude Code: no OS-level command containment on native Windows at all.** Its (recent, real, documented) sandboxing feature is macOS/Linux/WSL2-only — "The sandbox is built into Claude Code and runs on macOS, Linux, and WSL2. Native Windows is not supported." (code.claude.com/docs/en/sandboxing). On Windows it runs commands as plain child processes via the Bash (Git Bash) or PowerShell tool; "if the sandbox cannot start because dependencies are missing or the platform is unsupported, Claude Code shows a warning and runs commands without sandboxing." macOS: Seatbelt; Linux/WSL2: bubblewrap.
- **OpenAI Codex: yes to a Windows sandbox, but *not* (as shipped/documented) via AppContainer.** Docs (learn.chatgpt.com/docs/windows/windows-sandbox): native Windows uses either an **"elevated"** mode — dedicated lower-privilege *sandbox users*, filesystem boundaries, firewall rules, private desktop (this machine's own `%TEMP%` still carries the fossil: explicit `pookiepied\CodexSandboxUsers:(OI)(CI)(M)` ACEs, measured by this round's icacls snapshot) — or an **"unelevated"** restricted-token + ACL fallback; without its feature flags it runs *unsandboxed* on Windows (source: `get_platform_sandbox` returns `WindowsRestrictedToken` only when enabled, else `None`). An AppContainer-based path exists in the tree via Microsoft's **MXC** dependency (`codex-rs/mxc-sandbox`, `appcontainer_common`); whether it is what actually launches processes in the shipped default: **unverified** per the research pass.
- **OpenCode: nothing, anywhere.** Commands are plain `Effect` child processes (`packages/opencode/src/tool/shell.ts`: PowerShell `-NoLogo -NoProfile -NonInteractive -Command` on Windows, the configured shell otherwise); the docs' Tools/Permissions pages mention no OS mechanism, and their Windows advice is WSL2 "for the best experience" — a recommendation, not a boundary.

Plainly, as the handover asked: **none of the three uses AppContainer on native Windows today** (Codex's in-tree MXC dependency notwithstanding and marked UNVERIFIED where the wiring wasn't shown). Our harness is more isolated than all of them on this platform — which is simultaneously why git's needs hurt us first, and the reason the approach is worth one elevated, two-directory, one-time preparation instead of a surrender.

---

## 8. What ran (the reproduction appendix)

Invocation shapes, exactly as used; `$SID` = the (since-deleted) probe profile's SID, printed by the first line:

```bash
LX="C:/pookiepied/Dev Workspace/Project Studio/STUDIO HARNESS/vendor/win32-x64/studio-contain.exe"
"$LX" profile-ensure --name studio-gitfindings --display "Studio git research"   # → S-1-15-2-915815389-…717
"$LX" check  --sid S-1-15-2-1 --path "C:\Users" --mode traverse                   # → granted / missing
"$LX" grant  --sid $SID --path "…\ws1" --mode write|traverse|read                 # and: revoke --mode …
"$LX" run    --sid $SID --cwd "…\ws1" -- "C:\Program Files\Git\cmd\git.exe" status
"$LX" run    --sid $SID --cwd "…\ws1" --capability internetClient -- …            # §4.3 arm
"$LX" run    --sid $SID --cwd "…\ws1" -- "$LX" probe --path "C:\Users"            # the kernel questions, in-container
```

The icacls arms (the fix candidates) — and the gotcha that ate the first ladder silently:

```bash
export MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1      # else Git Bash rewrites /grant → C:/Program Files/Git/grant,
                                                        # icacls answers "Invalid parameter", and (with output redirected)
                                                        # a whole verification cycle verifies nothing — this happened.
icacls "C:\Users\pooki\AppData\Local\Temp" /grant "*S-1-15-2-1:(Rc,S,RD,X,RA)"
icacls "C:\Users\pooki\AppData\Local\Temp" /remove  "*S-1-15-2-915815389-…"     # teardown
subst X: "C:\Users\pooki\AppData\Local\Temp\git-sandbox-findings"                # §5;  subst X: /D to undo
git version --build-options                                                      # pins the exact build whose source was read
```

Also used, all read-only: `net session` (elevation check), PowerShell `Get-Acl … .Owner` (the §1.2 owners), `grep -c` over the two git binaries (the shim/real split), `icacls` bare (DACL snapshots), and `curl` of four files at the installed build's commit (`compat/mingw.c`, `setup.c`, `abspath.c`, plus one failed-then-succeeded).

Method notes for the next person: (i) the workspace grants mirror `containCommand`'s product on this machine — a faithful run would have granted *only* the three workspaces, because AAP-traverse (chain) and AAP-read (Git's trees, node's, Program Files) were already held; (ii) icacls renders masks in its own grammar and canonicalizes, so `(Rc,S,REA,RD,X,RA)`, `(Rc,S,RD,X,RA)` and the launcher's read-mode can all surface as plain `(RX)` — compare *bits via the probe or the launcher's `check`*, not via icacls cosmetics; (iii) the first, icacls-through-Git-Bash verification greps looked for the literal SID while icacls prints `S-1-15-2-1` resolved as `ALL APPLICATION PACKAGES` — both traps named here so nobody re-trusts a check that checked nothing.

## 9. What this investigation changed on this machine (all disclosed, all undone)

1. **Created, then deleted:** three scratch workspaces (`%TEMP%\git-sandbox-findings\ws1`, `…\ws3repo` (with a pre-made `.git`), `C:\Users\pooki\git-sandbox-findings\ws2`) — removed, verified gone.
2. **One AppContainer profile**, `studio-gitfindings` (SID `S-1-15-2-915815389-4243857639-3224034424-1884864580-3033965963-2388597802-488907817`) — created for the runs, deleted afterwards via `profile-delete`.
3. **ACEs added, then removed/restored:** my SID's `write` on the three workspaces; `traverse` on the two workspace-parents; icacls upgrades (traverse+LIST, then +REA, then −REA again) on the five user-owned chain directories, for both my SID and `ALL APPLICATION PACKAGES`; a propagating `read`-mode grant on the Python311 program root (the §6 cost datapoint), revoked after (11 s, verified zero ACEs of mine remain — `grep -c 915815389` → 0). One cosmetic residue: where I *restored* the AAP ACEs, icacls stored the traverse mask in generic form, so those four lines now read `(RX)` instead of the original `(Rc,S,X,RA)` — `GENERIC_EXECUTE` expands to exactly those bits, so they are semantically identical; a diff of icacls *text* would disagree, a diff of masks would not. The `%TEMP%` inherited capability-SID lines that were present in the first snapshot did not survive the add/remove cycles; they were inherited, transient, and no C: root/grant of mine could have produced them. Everything `C:\`, `C:\Users` and `D:\` untouched (all three grants *failed* — nothing was written).
4. **`subst X:`** — created for §5, removed (`subst X: /D`).
5. **Not touched:** the harness's own ACEs (every remove was `*<my-SID>`-scoped), the ledger (the TS side never ran — the launcher CLI was driven directly, so no ledger rows), `dist/` (no builds, no test suites), and anything requiring elevation (the two refusals *were* the measurement).
6. Four cached source files (~220 KB) in the OS temp from §2's citations. Sessions' HTTP(S) egress: the launcher's `probe --connect/--resolve` was not used this round; the only network was the four `curl` fetches and WebFetch attempts.

## 10. What remains unmeasured

- **Which of the two resolvers fails first** (`GetFinalPathNameByHandleW` vs the code path's semantics) — no syscall trace: no cdb (absent, measured), no Process Monitor (needs elevation; shell measured unelevated). The elimination in §2 is as far as behavior + the quoted source go.
- **Why `GetFinalPathNameByHandleW` — handle-only, nominally — fails inside the container** (if it indeed does): unverified. If it is the sole true culprit and `GetLongPathNameW` merely the noisy co-failed fallback, the *mask* fix is the same (something beyond traverse at the root/C:\Users), so the recommendation does not hinge on it — but the *next*-level explanation does.
- **The msys-2.0.dll 127 wall** — what it reads first, which right it lacks: unverified; it survives the *full* read+execute+LIST corridor, so it is a different disease than git's.
- **The `(RC)`/`(S)` purity bits** — present in every tested configuration (both trustees, both masks), so their necessity was never isolated. `SetEntriesInAcl`-shorthand caution applies.
- **Whether the drive root needs LIST specifically, or merely something `(RX)` provides** — untestable unelevated on this machine; the recommendation's mask (traverse+LIST) is the smallest *proven* one, not a proven-minimal one.
- **The propagated-read-grant cost on the home** — extrapolated from 15 s/11 s on ~10k files plus the `launcher.ts` 60 s history; not measured (deliberately: it risks a half-applied tree-wide DACL for a datapoint).
- **The exterior harnesses' interiors** — the research pass's own UNVERIFIED marks (Claude Code's non-doc secondary mechanisms; which Codex path actually launches; OpenCode's monorepo-wide absence) travel with that report.
