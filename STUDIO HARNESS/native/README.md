# `native/` — the parts of the sandbox Node cannot do

One folder, and it should stay small. Everything in here exists because a
containment primitive is a system call that JavaScript has no way to make.

| Directory | Platform | Why it exists |
|---|---|---|
| `windows-appcontainer/` | Windows | `CreateAppContainerProfile`, `UpdateProcThreadAttribute` and `CreateProcessW` are Win32 calls. Node has no binding for them, and a native addon would tie the harness's test suite to a compiled module on every platform. A standalone launcher is the smallest thing that works. |
| *(none)* | Linux | Deliberately empty. `bwrap` is the launcher and the OS supplies it, so there is nothing for us to build — the absence of a directory here is the design, not an omission. |

Built binaries are copied into `vendor/<platform>-<arch>/`, which is where
`src/vendor/resolver.ts` already looks for shipped programs. Nothing in the
harness locates a binary by walking `native/`.

See ADR 0041 and `documentation/work/stage-4b-plan.md`.
