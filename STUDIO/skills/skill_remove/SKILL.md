---
name: skill_remove
description: Remove a locally installed skill — unregisters it from the Skills catalog and deletes its files from $HOME/.studio/skills/. Use when the user wants to delete, remove, or uninstall a skill.
---

# Skill Remove

Remove a locally installed skill from both the Skills registry and the filesystem.

---

## Prerequisites

This skill uses the **Studio Harness** MCP tools. If the Harness is not connected (no `mcp_studio_harness__*` tools available), stop and ask the user to start it via **Extensions → Studio Harness → Start**.

You also need the cloud-side **Skills** tools: `skill_list`, `skill_unregister_local`. These are built-in STUDIO system tools.

---

## Workflow

### Step 1 — Identify the skill to remove

Ask the user for the skill key they want to remove. If they only have the name, look it up:

```
skill_list(user_id=<your user ID>, runtime="local")
```

Find the entry where `name` matches (case-insensitive) and note its `key`.

### Step 2 — Check if the skill is removable

From the skill list results, check the skill's `scope` and `sourceType`:

| Scope | Removable? |
|---|---|
| `local` + sourceType `local_path` or `github` | Yes — it's a user-installed local skill |
| `system` (bundled cloud skill) | No — it's part of the STUDIO system. Tell the user it cannot be removed. |
| `local` + sourceType `bundled` | No — it's a built-in local skill deployed with STUDIO. Tell the user it cannot be removed (but can be disabled in Settings). |

If the skill is not removable, explain why and stop.

### Step 3 — Confirm with the user

Show the user what will be deleted:

```
ask_user_question(
  question="I will permanently remove skill '{key}' ({name}). This will: (1) unregister it from your Skills catalog, and (2) delete the folder {localPath} and all its contents. This cannot be undone. Confirm?",
  suggestions=["Yes, delete it permanently", "No, keep it"]
)
```

Do not proceed without explicit confirmation.

### Step 4 — Unregister from the catalog

Call `skill_unregister_local` to remove the metadata from the Skills registry:

```
skill_unregister_local(
  user_id=<your user ID>,
  key=<skill key>,
  device_id=<optional device ID if device-scoped>
)
```

If this returns `removed: 0`, the skill was already unregistered (but files may still exist on disk). Continue to Step 5 to clean up.

### Step 5 — Delete the skill files

Verify the directory exists, then delete it:

```
ls(path={localPath})
```

If the directory exists:

```
delete_file(path={localPath}, recursive=true)
```

If `ls` returns an error (directory not found), that's fine — the files were already cleaned up. The registration was removed in Step 4.

### Step 6 — Confirm success

Report to the user:
- The skill key that was removed
- The folder that was deleted
- That the skill no longer appears in their catalog

---

## Edge Cases

### Bundle skills (system scope)

If the user asks to remove a bundled system skill (e.g. `product-self-knowledge`), reject the request. These skills are part of the STUDIO system and cannot be removed. They can be disabled in STUDIO Settings → Skills if the user wants to hide them.

### Skill already unregistered but files remain

If `skill_unregister_local` returns `removed: 0` but `ls(path={localPath})` shows files still exist, proceed with deleting the files. The skill was already unregistered from the catalog, so just clean up the orphaned folder.

### Skill registered but files missing

If `skill_unregister_local` succeeds (removed: 1) but `ls(path={localPath})` shows the directory doesn't exist, that's fine — just inform the user that the registration was cleaned up and there were no files to delete.

### Skill in use by running agents

If there are active conversations using the skill, the skill content is already loaded into context. Removing it won't break running conversations, but future calls to `skill_read` for that key will fail. Warn the user about this but allow them to proceed.

### Multiple skills with same key (shadowed)

If multiple registrations exist for the same key (one local shadowing a bundled skill), `skill_unregister_local` removes the local registration. The bundled version will become visible again. Tell the user: "Local registration removed. The bundled version of '{key}' is now active again."

### Deleting fails (permissions)

If `delete_file` fails with a permission error on Windows, try:

```
powershell(command="Remove-Item -Recurse -Force '{localPath}'")
```

If that also fails, register the orphaned folder path and ask the user to manually delete it.
