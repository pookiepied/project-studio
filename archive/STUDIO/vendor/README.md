# Vendored runtime binaries

This folder is STUDIO's **single, canonical home for third-party native binaries
that we ship bundled with the app** — the executables our tools shell out to that
are not guaranteed to exist on the user's machine.

It lives at the **STUDIO project root** (not under `library/mcp-servers/`) because it is
app-wide: any part of STUDIO — not just the MCP harness — can vendor a binary here.

The problem it solves: a fresh Windows install has **neither** `ripgrep` (`rg`)
**nor** `git`/Git Bash on `PATH`, yet the harness depends on both. Rather than
asking every user to install extra software — or degrading to a slower, subtly
different tool — we vendor them here, bundle them into the installer, and resolve
them at runtime.

## What's vendored

| Tool | Shape | Provides | Used by |
|------|-------|----------|---------|
| **ripgrep** | single binary | `rg` | `grep`, `outline_file` |
| **git** (Git for Windows) | full tree | `git.exe` **+** `bash.exe` **+** the POSIX toolchain (sed/awk/grep/ls/…) | all `git_*` tools, and the `bash` tool |

`git` is one download that serves two of our tools: the `git_*` tools run its
`git.exe`, and the `bash` tool runs its `bin/bash.exe`. Git Bash is **not** a
separate deliverable — it lives inside the git tree. On macOS/Linux git is
provided by the OS, so nothing is vendored there and the resolver uses `PATH`.

## Layout

```
vendor/
  manifest.json                     # source of truth: pinned versions, checksums, paths
  README.md                         # this file
  ripgrep/<platform>/rg[.exe]       # file-kind: one binary
  git/<platform>/                   # tree-kind: cmd/git.exe, bin/bash.exe, mingw64/…, usr/…
```

`<platform>` uses the `${process.platform}-${process.arch}` convention
(`win32-x64`, `darwin-arm64`, `linux-x64`, …) so the resolver picks the right
binary at runtime with zero configuration.

## Not committed — fetched at build time

The binaries themselves are **not** committed (they're large and fully
reproducible); `.gitignore` tracks only `manifest.json` + this README. They are
fetched from pinned, checksummed upstreams by `scripts/vendor-sync.mjs`:

- **ripgrep** from the `@vscode/ripgrep` npm package.
- **git** from a pinned [Git for Windows](https://github.com/git-for-windows/git)
  PortableGit release (SHA256-verified), self-extracted and trimmed of docs, man
  pages, translations, vim, and the Tcl/Tk GUIs (gitk/git-gui) — the runtime
  git/bash/DLLs/subcommands are kept intact.

`scripts/tauri-wrapper.mjs` runs `vendor-sync` before every `dev`/`build`, so
packaged apps always ship a known-good copy and **end users never download
anything** — the binaries are inside the signed installer. The sync is idempotent
(no-ops when current) and self-heals a corrupt/interrupted download via checksum
+ retry.

## How it ships

`src-tauri/tauri.conf.json` lists `../vendor` under `bundle.resources`, so the
whole folder is copied into the app's resource dir at install time. The resolver
(`library/mcp-servers/harness/studio-harness/src/tools/shared/vendor.ts`) walks up from its own
bundle location to find `vendor/` in both dev and packaged builds.

## Resolution order (in the tools)

1. **Vendored binary/tree** in this folder (preferred — always present, pinned version).
2. **`PATH` binary** of the same name (a dev's own install — still the real tool).

There is **no divergent fallback** (no `cmd.exe` for bash, no pure-JS search): the
tools run the real binary or return a clear error. If neither a vendored nor a
`PATH` copy is found, run `vendor-sync` to restore it.

## Adding / refreshing a binary

Run the sync script from the STUDIO root:

```
node scripts/vendor-sync.mjs            # refresh everything for the current platform
node scripts/vendor-sync.mjs git        # just one tool
node scripts/vendor-sync.mjs --force    # re-download/re-extract even if current
```

Pinned versions and checksums live in the `TOOLS` table at the top of
`scripts/vendor-sync.mjs`. To bump git, update the release URL + SHA256 there
(both are in the git-for-windows GitHub release), then run `--force`.

> Note: the sync script only fetches for the platform it runs on. To vendor all
> platforms, run it once on each OS/arch (or in CI matrix jobs).
