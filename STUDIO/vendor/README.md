# Vendored runtime binaries

This folder is STUDIO's **single, canonical home for third-party native binaries
that we ship bundled with the app** — the executables our tools shell out to that
are not guaranteed to exist on the user's machine.

It lives at the **STUDIO project root** (not under `mcp-servers/`) because it is
app-wide: any part of STUDIO — not just the MCP harness — can vendor a binary here.

The problem it solves: a fresh Windows (or minimal Linux) install does **not** have
`ripgrep` (`rg`) on `PATH`, yet the studio-harness `grep` and `outline_file` tools
depend on it for fast search. Rather than asking every user to install extra
software — or degrading to a slower, subtly-incorrect search — we vendor the binary
here, bundle it into the installer, and resolve it at runtime.

## Layout

```
vendor/
  manifest.json                # declares each tool: source, version, per-platform path
  README.md                    # this file
  <tool>/<platform>/<exe>      # the actual binaries, e.g. ripgrep/win32-x64/rg.exe
```

`<platform>` uses the `${process.platform}-${process.arch}` convention
(`win32-x64`, `darwin-arm64`, `linux-x64`, …) so the resolver can pick the right
binary at runtime with zero configuration.

## How it ships

`src-tauri/tauri.conf.json` lists `../vendor` under `bundle.resources`, so the whole
folder is copied into the app's resource dir at install time. The studio-harness
resolver (`mcp-servers/studio-harness/src/tools/shared/vendor.ts`) walks up from its
own bundle location to find `vendor/` in both dev and packaged builds.

## Resolution order (in the tools)

1. **Vendored binary** in this folder (preferred — always present, correct version).
2. **`PATH` binary** of the same name (a user's own install — still real ripgrep).

There is **no pure-JS fallback**: the tools always run real ripgrep so behavior is
identical everywhere (including `.gitignore` handling). If neither a vendored nor a
`PATH` binary is found, the tool returns a clear error instead of a degraded search —
run `vendor-sync` (below) to restore the bundled binary for your platform.

## Adding / refreshing a binary

Run the sync script from the STUDIO root:

```
node scripts/vendor-sync.mjs            # refresh everything for the current platform
node scripts/vendor-sync.mjs ripgrep    # just one tool
```

The script obtains binaries from their upstream npm packages (e.g. ripgrep from
`@vscode/ripgrep`), copies them into the correct `<tool>/<platform>/` path, and
updates `manifest.json`. Commit the resulting binaries so builds are reproducible
and work offline.

> Note: the sync script only fetches the binary for the platform it runs on.
> To vendor all platforms, run it once on each OS/arch (or in CI matrix jobs).
