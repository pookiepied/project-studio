# `native/` — the parts of the sandbox Node cannot do

Deliberately empty, and kept so the absence is a statement rather than an
oversight.

| Platform | Why nothing is here |
|---|---|
| Linux | `bwrap` is the launcher and the OS supplies it. There is nothing for us to build. |
| Windows | There was a launcher here - `windows-appcontainer/`, a Rust binary that applied an AppContainer to a child process - from ADR 0041 until ADR 0057 removed it. Containing a developer's shell that way meant writing permission entries onto the real filesystem for every workspace and every ancestor down from the volume root, and the entries accumulated until the ACLs could hold no more. On Windows the permission gate is the boundary now, and no binary is needed to apply it. |
| macOS | No backend, by decision. |

If a fence worth having appears for a platform, its launcher goes here, its
built binary goes into `vendor/<platform>-<arch>/` where `src/vendor/resolver.ts`
already looks, and the decision gets an ADR.
