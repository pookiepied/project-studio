# TASK 59 - The folder the person actually picked

Adding a folder to a project does not open a file dialog. It invents a path.

`STUDIO/src/features/projects/NewProjectDialog.tsx`, `addFolder`:

```ts
{ name: ..., path: `D:/Work/${slug}${index === 1 ? '' : `-${index}`}` }
```

The file says so honestly at the top: *"The picker is demo-only in this build -
it appends a plausible path rather than opening the OS dialog, because the real
one is a Tauri capability that belongs with the harness work. The shape of what
it produces is real, so swapping it is one function."*

This task does that swap. It is small in code and careful in permissions, which
is why it is its own task rather than part of Task 58.

Task 58 makes a project's folders into sandbox roots. Until this task lands,
every project points at a fabricated path on a drive that may not exist. The
two together are what makes a project real; do this one second.

---

## Part 0 - What exists

**No dialog plugin.** `STUDIO/src-tauri/Cargo.toml` has no
`tauri-plugin-dialog`, and `package.json` has no `@tauri-apps/plugin-dialog`.
Both halves have to be added, and the plugin registered in `lib.rs` beside the
ones already there.

**The capability file has a house style, and it is strict.**
`STUDIO/src-tauri/capabilities/default.json` enumerates individual permissions
rather than taking any plugin's `default` bundle, and each group carries a
comment saying why exactly those. Read the `//store` comment: `store:default`
was replaced by the five operations the app actually calls, because a granted
capability nothing needs is a standing invitation. Follow that. Grant the one
dialog operation this feature uses, not `dialog:default`.

**Every window label must be listed.** The same file's opening comment explains
that a window missing from `windows` does not fail loudly, it renders wrong -
it cost the app its traffic lights once and its theme a second time. The dialog
is opened from the main window, so nothing new is needed there, but read the
comment before touching this file so you understand what it is protecting.

**The frontend already has the shape.** `addFolder` produces
`{ name, path }` and the harness route already accepts it. Nothing downstream
changes.

---

## Part 1 - A real directory picker

Add the plugin, register it, grant the single permission, and replace
`addFolder`'s body with a call that opens the OS directory dialog.

What the new `addFolder` must do:

- Open a **directory** picker, not a file picker.
- Do nothing at all when the person cancels. No folder appended, no error, no
  toast. Cancelling is the most common outcome of opening a dialog and it is
  not a failure.
- Use the picked directory's own last path segment as the folder name, rather
  than the slug of the project name. The point of a picker is that the person
  chose something; naming it after the project throws that away. Keep the name
  editable if the dialog already allows renaming - do not add an editor if it
  does not.
- Refuse a duplicate. `ProjectStore.create` already throws `conflict` on the
  same path twice, and the frontend should say so before the round trip rather
  than after.

**Outside Tauri, it must not be broken.** `vite dev` in a browser has no
dialog. The existing pattern for this is `isTauri()` in
`STUDIO/src/platform/tauri`, which `connection.ts` already uses to fork on
exactly this question. Outside Tauri, the Add folder control should say the
picker needs the desktop app rather than silently doing nothing or throwing.
Do not restore the fabricated path as a fallback - a fake path that reaches the
store is the bug this task exists to remove.

---

## Part 2 - Validation is the harness's job, not the dialog's

Do not add path checks in the dialog handler. Task 58 puts absoluteness, the
existence check, and the volume-root and system-directory refusal in
`ProjectStore`, using `systemScopeRefusal` from `src/sandbox/scope.ts`. A
picker cannot be the place that decides what a valid folder is, because the
HTTP route is reachable without it.

What the frontend does owe the person is the message. When the store refuses a
folder, show the harness's own sentence verbatim - a refused system directory
names `trusted`, and paraphrasing it in the dialog loses the remedy. The
Environments pane already does exactly this with `lastError`; follow it.

If Task 58 has not landed when you start this, say so in your report and build
against the store as it is. Do not write the validation yourself.

---

## Part 3 - Verification

Some of this cannot be tested in vitest, because a native dialog is native.
Say clearly in your report which claims are covered by a test and which you
verified by hand in the running app.

Tested:

1. Cancelling the picker appends nothing and raises nothing.
2. A picked directory becomes a folder named after its own last segment.
3. Picking a directory already on the project is refused before the request.
4. Outside Tauri the control explains itself and appends nothing.
5. A store refusal renders the harness's sentence verbatim.

Verified by hand, with what you saw written down:

6. The dialog actually opens from the running desktop app, and picking a real
   directory creates a project whose folder is that directory.
7. The capability grant is the narrow one. Remove the granted permission,
   confirm the dialog is rejected, put it back. This is the negative control
   for a permission, and it is the one worth doing: an over-broad grant passes
   every test a narrow one passes.

Start the app with `start.bat` at the repo root. Do not start the harness by
hand and do not open the Vite dev server in a browser - the supervisor owns the
harness and mints its credential, and the browser path cannot open a dialog
anyway.

---

## Part 4 - Out of scope

- **Anything in Task 58.** The sandbox roots, the folder validation, the
  environment block, the Environments pane.
- **Editing folders after creation.** `ProjectPage` lists folders without
  add or remove controls. Adding them is worth doing and is not this.
- **A file picker anywhere else** - attachments, exports, anything. One
  capability, one caller, in this task.
- **Drag and drop onto the window.** A different Tauri surface with its own
  permission, and a different task.

---

## Part 5 - Rules

- No `any`, no non-const `as`, no non-null `!`.
- UTF-8, no BOM. Em dash in comment prose only. No en dashes, smart quotes,
  curly apostrophes, ellipsis characters, or emoji in source.
- Preserve each line's existing CRLF or LF ending.
- Pin the plugin to an exact version on both sides, and make the Rust and npm
  versions match. Say in your report which versions you chose.
- Run vitest suites one at a time, never concurrently.
- `Backend/`, `docs/`, `documentation/`, `prompts/`, `opencode/` are read-only.
  Write exactly one file outside the code: your report at
  `report/TASK-59-the-folder-the-person-actually-picked.md`.
- No git commands that move HEAD or the index: no `checkout`, `switch`,
  `stash`, `reset`, `clean`, `commit`, `rebase`. Leave the work in the tree.
- Do not write to the D: drive. When you test the picker by hand, pick a
  throwaway directory you created for it, not a real project.
- Report what you found and did not fix, what the brief got wrong, and every
  rule you added that this task did not ask for.
