---
name: skill_install
description: Install a skill from a GitHub repository URL or local folder path. Validates the skill format, places files in the correct location under $HOME/.studio/skills/, and registers it with the Skills system. Use when the user wants to install, add, or import a skill from GitHub or a local directory.
---

# Skill Install

Install a skill from a GitHub URL or local folder path into the STUDIO skills system.

---

## Prerequisites

This skill uses the **Studio Harness** MCP tools. If the Harness is not connected (no `mcp_studio_harness__*` tools available), stop and ask the user to start it via **Extensions → Studio Harness → Start**.

You also need the cloud-side **Skills** tools available: `skill_install_plan`, `skill_validate`, `skill_register_local`. These are built-in STUDIO system tools — no extension needed.

---

## Workflow

### Step 1 — Determine the source type

Identify whether the source is a GitHub URL or a local path:

- **GitHub URL**: starts with `http` and contains `github.com` (e.g. `https://github.com/user/repo`, `https://github.com/user/repo/tree/main/src/my-skill`)
- **Local path**: starts with a drive letter (Windows) or `/` (Unix), or is a relative path like `./my-skills/custom-skill`
- **Neither**: ask the user for clarification.

### Step 2 — Get the install plan

Call `skill_install_plan` with the source string:

```
skill_install_plan(source="https://github.com/user/repo")
```

This returns a safe, reviewable plan with:
- `sourceType`: `"github"` or `"local_path"`
- `targetPath`: `$HOME/.studio/skills/{key}/`
- `steps`: ordered actions
- `notes`: warnings (e.g. install scripts detected — these will be skipped)
- `requiresLocalRuntime`: always `true` — cloud never performs the install

Review the plan. If any step includes "install script" or "post-install hook", **note these will be skipped**. Warn the user if they expected scripted setup.

### Step 3 — Confirm with the user

Call `ask_user_question`:

```
ask_user_question(
  question="I will install skill '{key}' into {targetPath}. This will create the directory and register it in your Skills catalog. Confirm to proceed.",
  suggestions=["Yes, install it", "No, cancel"]
)
```

Do not proceed without confirmation.

### Step 4 — Clone or copy the skill files

#### GitHub source

Use `bash` to clone the repo (shallow clone, no history):

```
bash(command="git clone --depth 1 {repo_url} {targetPath}", timeout=60000)
```

If the source includes a sub-path (e.g. `github.com/user/repo/tree/main/src/my-skill`), clone to a temp directory first, then move only the sub-path:

```
bash(command="git clone --depth 1 {repo_url} {tempPath}", timeout=60000)
```

Then copy the sub-path:

```
bash(command="cp -r {tempPath}/{subPath} {targetPath}")
```

Then clean up the temp directory:

```
delete_file(path={tempPath}, recursive=true)
```

On Windows, use `powershell` instead of `bash` if path handling is tricky:

```
powershell(command="Copy-Item -Recurse -Force '{tempPath}\\{subPath}' '{targetPath}'")
```

#### Local path source

List the source directory to verify it contains `SKILL.md`:

```
ls(path={sourcePath}, recursive=true)
```

Then copy it to the target path:

```
bash(command="cp -r {sourcePath}/. {targetPath}", timeout=30000)
```

Or on Windows:

```
powershell(command="New-Item -ItemType Directory -Force -Path '{targetPath}'; Copy-Item -Recurse -Force '{sourcePath}\\*' '{targetPath}'")
```

### Step 5 — Validate the skill package

Read the `skill.json` (if it exists) and `SKILL.md`:

```
read_file(path="{targetPath}/SKILL.md")
```

```
read_file(path="{targetPath}/skill.json")   # only if it exists
```

Then call `skill_validate` to check format compliance:

```
skill_validate(
  manifest=<parsed skill.json object, if present>,
  skill_md=<raw SKILL.md text>
)
```

Check the result:
- `valid: true` → proceed to Step 6
- `valid: false` → show the user the errors. Ask if they want to fix the skill files first or abort. Common issues:
  - Missing `name` or `description` in frontmatter → the SKILL.md is malformed; either fix it or reject
  - Invalid `allowed_runtime` → must be one of `cloud`, `local`, `both`
  - Key mismatch between skill.json `key` and frontmatter `name` → they should match; ask the user which to use

If the user wants to fix issues, use `edit_file` to patch the files, then re-validate.

### Step 6 — Derive registration metadata

Extract the following from the validated skill package:

| Field | Source |
|---|---|
| `key` | `skill.json.key` or the frontmatter `name` field |
| `name` | `skill.json.name` or the first H1 heading in SKILL.md |
| `description` | `skill.json.description` or the frontmatter `description` field |
| `category` | `skill.json.category` or `"General"` |
| `version` | `skill.json.version` or `"1.0.0"` |
| `allowed_runtime` | `skill.json.allowed_runtime` or `"local"` |
| `source_type` | `"github"` or `"local_path"` |
| `source_url` | the original GitHub URL, or `null` for local paths |
| `local_path` | the target path `$HOME/.studio/skills/{key}/` |
| `content_hash` | compute via `bash(command="sha256sum {targetPath}/SKILL.md \| awk '{print $1}'")` or `powershell(command="(Get-FileHash '{targetPath}\\SKILL.md').Hash.ToLower()")` |
| `manifest_json` | the raw skill.json content, or `"{}"` if no manifest |

### Step 7 — Register the skill

Call `skill_register_local` with the derived metadata:

```
skill_register_local(
  user_id=<your user ID>,
  key=<derived key>,
  name=<derived name>,
  description=<derived description>,
  category=<derived category>,
  version=<derived version>,
  allowed_runtime=<derived runtime>,
  source_type=<derived source type>,
  source_url=<derived source URL>,
  local_path=<derived local path>,
  manifest_json=<derived manifest JSON>,
  content_hash=<derived content hash>,
  device_id=<optional device ID>
)
```

### Step 8 — Confirm success

Report to the user:
- The skill key
- The installed path
- Where to find it in the Skills catalog
- That they can call `skill_read(skill=<key>)` to use it

---

## Edge Cases

### Key collision — skill already exists

Before registering, check if the key is already registered:

```
skill_list(user_id=<your user ID>, runtime="local")
```

If the key already exists in the local skills list, ask the user:
- **Overwrite**: unregister the existing skill (`skill_unregister_local`), delete the old directory, and proceed with the new install
- **Use a different key**: pick a new key (e.g. append `-2` or a version suffix), update the skill files, and proceed
- **Cancel**: abort

### No SKILL.md — invalid skill

If the cloned/copied directory has no `SKILL.md`, the skill is invalid. Do not register it. Tell the user what files were found and that `SKILL.md` is required. Offer to create one using `skill_create` instead.

### No skill.json — parse from frontmatter

If `skill.json` is missing, that's fine — the system supports skills with only `SKILL.md`. Metadata is parsed from the YAML frontmatter (`name` and `description` fields). Pass `manifest_json="{}"` to the registration.

### Install scripts or post-install hooks

If the skill package contains `install.sh`, `setup.py`, `post-install.js`, or similar:
- **Never execute them.**
- Warn the user that install scripts were found and skipped.
- The skill will be installed without the scripted setup.
- If the skill requires a specific setup, document it as a note for the user.

### Large repos — only copy the skill folder

If cloning from GitHub, the repo may contain multiple skills or unrelated files. Only copy the specific skill folder (the one containing `SKILL.md`). Use `ls(recursive=true)` on the cloned temp directory to find the skill folder if the sub-path wasn't specified.

### Network or git failures

If `git clone` fails (network error, auth error, repo not found), inform the user with the exact error message. Suggest:
- Checking the URL
- Using a personal access token for private repos
- Trying `https` instead of `ssh`

### Permission issues on Windows

If file copy fails due to permissions on Windows, try `powershell` with elevated context or check antivirus quarantine. The `$HOME/.studio/skills/` directory should be writable by the current user.
