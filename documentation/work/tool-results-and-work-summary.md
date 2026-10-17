# Tool results and completed work

Implemented in Studio's transcript renderer and side rail. These are production components; temporary preview HTML used for visual checks is removed after inspection.

## Coverage

| Tools | Presentation |
| --- | --- |
| read | A statement; only failures expand, as before. |
| edit, write | Existing file diffs. |
| move, delete | Paths, operation details, recovery receipts and outcome. |
| glob, grep | Existing query and search results; readable fallback for unfamiliar answers. |
| shell, git | Command/output panel. Nonzero shell exits are failures. Background launches show the job receipt without model-facing polling instructions. |
| plan | Returned plan steps and their actual statuses, including user edits. |
| discover | Returned extension/tool names as words, without the schema or model-facing instructions. Missing/unavailable tools are reported as failures. |
| task | Assigned agent, prompt and the agent's returned answer. The parent log does not contain the delegate's internal trace. |
| jobs | Native command and media job receipts with state when checked, including nonzero exits. The existing Background work rail remains the live status/control surface for jobs and background agents. |
| library_search, library_keep | Library item titles, file types, paths, subjects and tags. |
| Studio browser/computer MCP | Existing screenshot and step reports. Browser URLs/screenshots can also appear beneath the final answer. |
| studio_image, studio_video | Existing media artifacts, retained as final results outside collapsed history. No new video workflow is introduced. |
| Studio customization and other MCP calls | Protocol-aware MCP view: readable request fields, text/structured results, supported inline images and actual isError status. No transport content/type/text field dump. |
| OCR, folder requests and unfamiliar tools | Shared readable field/list presentation with a status footer. No specialized OCR page viewer or folder picker is added here. |

## Completed-work policy

Only a completed, settled assistant turn with a produced task result gets the work summary: recorded successful file changes or returned generated-media artifacts. Tool use alone does not establish a task. Reading a photo/file, reasoning, searching, browsing, running commands, planning, discovery, checking jobs or delegation alone keeps the normal activity group and reply, irrespective of call count, duration or how task-like the final sentence sounds. Shell-only and third-party work without a recorded deliverable conservatively remains in that normal presentation. Live turns, failed/aborted turns, and turns with unanswered tools remain visible in their existing chronology.

The two disclosures have different purposes. An activity group always describes its tools ("Read files", "Changed files, ran commands", "Used the browser"). Only the outer completed-task disclosure can use an outcome title. Result cards can surface recorded outputs independently of whether a turn qualifies for that task title.

The joined transcript preserves the final provider message's answer boundary. Earlier commentary, reasoning and tools go inside the expandable history; the final answer remains visible. The title is derived independently from verified results: for example, "Updated search.ts", "Created 3 files", or "Generated an image". It does not copy the answer's opening sentence, and never claims a bug was fixed solely because an edit returned successfully. Counts represent distinct changed files or generated artifact references, not tool calls. No extra agent, provider request, system-prompt change, elapsed-time estimate or backend storage is needed. Copy/read-aloud operate on the visible final answer.

Activity summaries describe kinds of work without numeric tool counters. Chevrons appear on hover/focus or while expanded.

Live turns retain their visible chronological transcript and normal activity-group disclosures. There is no outer work title or divider while the turn is in flight, including while tools run after the provider message closes. Only a settled, completed turn that meets the completed-work policy gets the outer collapsed history, result title, and horizontal divider. Ordinary read/search conversations retain their normal presentation.

Tool-result bodies are capped at 20rem and scroll internally in both directions, with keyboard focus and contained scroll gestures. Their headings and status footers stay outside the scrolling body. Expanded activity lists are capped at 32rem; search results also have bounded internal scrolling. Shell and job output use the shared result scroller rather than a second nested one.

Growing Markdown code blocks render their numbered plain-text body while streaming, and syntax highlighting runs when the block settles. Finished blocks remain memoized. Code highlighting's deferred fallback appears immediately: the generic deferred-surface delay must not temporarily remove an existing code body and change transcript height. The main scroll-follow engine is unchanged.

## Result cards and review

Recorded successful file operations produce a card below the answer. It initially shows three paths, can reveal the rest, and opens a turn-keyed File changes entry in the side rail. Individual paths open their recorded operations and diffs. There is no Undo control.

This is a review of file-tool receipts, not a Git workspace diff. Arbitrary shell modifications and unrecorded delegate filesystem effects are not counted. Repeated edits are coalesced, and numeric additions/removals appear only when the recorded calls prove the comparison. Replacing an existing whole file has no known original contents, so its net counts are omitted.

Browser results appear as Web preview cards with an icon tile and an Open in menu (Studio preview, Default browser, Copy link). Clicking the card or its recorded screenshot opens the full preview in the side rail. These turn/page-keyed entries are independent of the standing live browser report, and have no live Stop control. Only actual returned HTTP(S) URLs are included; the last page per tab is deduplicated, and screenshots are retained across text-only calls but reset on navigation. Without a recorded screenshot the card remains a website entry and the rail explains the absence. The desktop command opens the OS default browser with separate process arguments and validates the URL scheme on both sides. The web client opens a separate tab. There is no embedded browsing engine or browser-selection setting.

Generated media reuses the existing artifact renderer outside collapsed history. A background launch gets a link to the existing current-status rail; its receipt does not claim that a historical job is still running.

## Pre-merge review

The 2026-10-17 review found and repaired four regressions: native Git failure
receipts displayed as successful, newly opened result entries discarded when
twelve standing rail entries were exempt from eviction, browser helper exits
reported as successful without waiting/reaping, and historical disclosure mounts
emitting fresh delivery observations. A separate inspection bound the Windows
browser opener to the OS system directory rather than workspace/PATH lookup.
The opener removes inherited PATH, passes the URL as one argument, and waits
for the helper off the UI thread. No browser is opened by its tests.

New UI regressions failed in all three cases before repair, then passed all 21
tests across their three files. Deliberately removing the three repairs failed
the same three tests. Native mutations of executable selection, scheme validation
and exit reporting failed all three corresponding tests; removing PATH isolation
separately failed its assertion too. All deliberate mutations were restored.
Final checks passed: client typecheck/lint and 1,537 tests; native 145 tests;
Clippy with warnings denied. The harness sources are unchanged from the full
2,448-pass / 28-skip gate. A follow-up read-only review found no remaining
actionable P1/P2 findings in the repaired scope. The frozen source manifest was
checked again before the commit. Merge/push safety includes a verified Git
bundle and hash-verified copies of every pre-existing uncommitted file.
