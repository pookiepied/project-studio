---
description: Review the changes on the current branch and report what needs fixing
argument-hint: [focus]
---

Review the uncommitted and unpushed changes in this workspace. Read the diff first, then the files it touches where the diff alone does not explain the change.

Report only what a reviewer would actually raise: bugs, behaviour that disagrees with the surrounding code, missing handling of a failure the code can reach, and tests that no longer pin what they claim to. Skip style remarks unless the file's own conventions are broken.

For each finding give the file and line, what is wrong in one sentence, and the smallest change that fixes it. If nothing needs fixing, say so plainly.

$ARGUMENTS
