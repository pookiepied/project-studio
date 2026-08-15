# Vendored Binaries

Programs Project Studio ships because a user's machine normally does not have
them. Resolution order is vendored, then the system, then a refusal — see
`src/vendor/resolver.ts`.

Layout is `vendor/<platform>-<arch>/<binary>`, matching `platformKey()`.

Record every binary here with the exact source and hash it was taken from. A
vendored executable with no provenance is one nobody can verify later, and
"where did this .exe come from" is not a question to answer from memory.

## ripgrep 14.1.1 · `win32-x64/rg.exe`

| | |
|---|---|
| Source | <https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip> |
| Archive SHA-256 | `D0F534024C42AFD6CB4D38907C25CD2B249B79BBE6CC1DBEE8E3E37C2B6E25A1` |
| `rg.exe` SHA-256 | `F162B54DE2ADFC72D78ADB1DBADA2DEDDA111AE0A5E2F6E9500F4F909664C5D2` |
| Size | 5,407,744 bytes |
| Licence | MIT / Unlicense — no redistribution obligation |
| Build | PCRE2 10.43 with JIT; runtime SIMD detection |

Pinned to an exact version rather than "latest": a search that silently changes
behaviour between installs is a search whose results cannot be reproduced.

**These hashes were computed from our own download.** They pin what we shipped,
so a later re-vendor can be compared against them — but they are not an
independent verification of the upstream artefact. Checking a published
signature is recorded as V-01 in `docs/KNOWN-ISSUES.md`, and matters most when
binaries start being fetched on demand rather than committed.

## ripgrep 14.1.1 · `linux-x64/rg`

| | |
|---|---|
| Source | <https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz> |
| Archive SHA-256 | `4CF9F2741E6C465FFDB7C26F38056A59E2A2544B51F7CC128EF28337EEAE4D8E` |
| `rg` SHA-256 | `F401154E2393F9002AC77E419F9EE5521C18F4F8CD3E32293972F493BA06FCE7` |
| Size | 6,597,984 bytes |
| Licence | MIT / Unlicense — no redistribution obligation |
| Build | PCRE2 10.43 with JIT; runtime SIMD detection |

## studio-contain 0.1.0 · `win32-x64/studio-contain.exe`

**Ours, not a third party's.** The first entry here that we wrote, which makes
the provenance question a different one: not "where did this come from" but
"what produces it, and can anyone reproduce it".

| | |
|---|---|
| Source | `native/windows-appcontainer/`, in this repository |
| Build | `cargo build --release` with rustc 1.96.0 |
| SHA-256 | `17B33816D91CD5E467CEBF12E19DBF0123ED0E4745FD9BC9DF7680C517CCE039` |
| Size | 130,560 bytes |
| Dependencies | `windows-sys` only |
| Licence | ours |

Committed rather than built during install, for the same reason `rg.exe` is:
the harness's test suite must not require a Rust toolchain on every machine
that runs it. The cost is that the binary and its source can drift, so the hash
above is what a rebuild is compared against.

It is not byte-reproducible across toolchain versions — `lto` and `strip` make
the output compiler-specific — so a differing hash after a rebuild is expected
and is not by itself evidence of tampering. What is checked instead is that the
source in `native/` compiles and that the behaviour tests in
`tests/integration/sandbox-appcontainer.test.ts` pass against the shipped copy.

## Not vendored

**git.** Developers overwhelmingly have it, it is ~50 MB extracted rather than
one file, it is GPLv2 with redistribution obligations, and it needs security
updates on git's schedule rather than ours. Resolved from the system; the
resolver refuses with an actionable message when it is absent.
