# Conversation rendering review

Date: 2026-10-21

## What the screenshots reveal

The immediate problem is document rendering and reading hierarchy. The useful
reference is the way formatted user messages, answer paragraphs, emphasis, lists,
and supporting material form one readable conversation. Copying an accent color
would not fix the underlying behavior.

## Causes found in Studio

- `CollapsibleText.tsx` rendered the entire user message in a plain paragraph.
  Markdown headings, emphasis, lists, and code had no parser at this boundary.
- The first visual pass introduced a separate prose token two pixels above the
  interface size. At the default setting, chat became 14px while controls stayed
  12px, and a local code override made the configured 11px code size render at
  13px. That mismatch has been removed. Tables had also stepped down to caption
  size, making answer content look like interface metadata.
- `segment.ts` parsed blank-line fragments independently. Its continuing-block
  heuristic retained simple lists, but lost indented continuation paragraphs and
  nested lists. Reference definitions could not resolve links in earlier fragments.
- The Markdown image renderer has no conversation workspace resolver. A path
  such as `workspace/crypto_indexed_60d.png` becomes a browser-relative image URL,
  explaining the broken-image presentation in the supplied Studio screenshot.
  Inline code paths are code spans, without file identity or preview behavior.

## Implemented foundation

User bubbles now use the existing Markdown stack, with raw HTML disabled and
artifact fences presented as quoted text rather than application artifacts.
Single line breaks in user paragraphs remain visible. Copy still receives the
original message, and the existing measured expand/collapse mechanism remains.

Conversation prose shares the existing body size, level with the interface,
and inherits the global user code-size preference. The chat column and composer
share the original body-derived reading measure. Tables use body size. All six
heading levels and nested paragraphs retain deliberate typography and spacing.

Indented continuations and reference definitions keep their document context.
Ordinary paragraphs and fenced code retain the existing memoized streaming path.
The conservative document path reparses complex documents as they grow; it is a
correctness improvement, not a claim that large-document streaming is optimized.

`ConversationSection.tsx` adds a development preview using the actual user and
streamed-answer renderers, with theme controls and replay at `/showcase.html`.

## Next work, kept separate

1. Resolve file references through a conversation-scoped artifact identity. Reuse
   the existing authenticated byte transport and attachment viewer where possible.
   An arbitrary model-emitted path must not grant filesystem access. Support
   explicit unavailable states, hover/focus previews, and deliberate open actions.
2. Introduce one bounded visual-result envelope for static images, charts, and
   isolated interactive documents. Persist provenance, media type, and content
   references independently of explanatory Markdown. Arbitrary executable HTML
   should not be added to the prose sanitizer.
3. Keep a short visual capability description in the agent's normal context.
   Load topic-specific instructions on demand through the existing skill
   mechanism. Educational diagrams, comparisons, data analysis, and geographic
   views can share this delivery path without loading every category each turn.
4. Prefer generated Python plots for exportable scientific figures and isolated
   HTML experiences when direct manipulation helps. Data acquisition remains with
   the existing tools or enabled MCP integrations; presentation does not supply
   new authority or certify the underlying data.

These later capabilities are design directions, not implemented features. The
additional category example images were not needed to change the immediate text
renderer. The supplied product-release descriptions were treated as inspiration,
not independently verified claims about OpenAI products.

## Verification

Focused rendering tests passed before negative controls: 25 tests across three
files. Removing the fixes made the user-heading test and both nested-list and
reference-link tests fail as expected. The fixes were restored. A further test
guards memoization of indented fenced code. Light and dark previews were inspected
visually at a narrow viewport. Full client checks are recorded in the chat report.

No new transport, tool, native command, collection policy, or execution boundary
was added. Existing delivery observations and identity propagation remain in place.
Work stays on `codex/side-workspace`; no commit was made. Pre-existing workspace
and observability edits were preserved.

## Link previews and component library follow-up

Studio's primitives are custom React components, styled with Tailwind, with
Lucide icons and Framer Motion. The Popover source explicitly records the
decision to own its small floating menu rather than import a headless library.
A component migration could happen incrementally, but replacing the library alone
would retain the document-rendering defects described above. No dependency was
added; the repository's existing no-new-dependency rule remains satisfied.

Markdown web links now open a local destination popover with the supplied label
or title, hostname, URL, Open in browser, and Copy link. Opening the popover does
not fetch the destination or invent a page description. Numbered Markdown links
receive a compact inline citation treatment. Internal anchor navigation remains
available; executable and local-file URLs cannot reach the external launcher.

On desktop, Open in browser calls the existing `openExternalUrl` adapter and
`open_external_url` native command. This uses the operating system's registered
default browser (such as Chrome or Edge), not Studio's embedded browser. The web
client opens a separate browser tab. Existing native command instrumentation
covers the reused boundary; no URLs, link text, or new content capture are added
to operational observations. Launch and clipboard failures remain visible.

The inline popover uses a span anchor so links remain valid paragraph content.
Its keyboard path focuses the first action, navigates actions with arrow keys,
and restores the link's focus on Escape. Tests cover destination preview,
explicit launch, copying, numbered citations, refusal, internal anchors, and
keyboard navigation. Negative controls disabling launch and citation recognition
failed the corresponding tests before the implementation was restored.

The palette source scan was taught that `prose` is a typography token, like
`body` and `caption`; it previously misclassified the new CSS variable as an
undeclared color utility. That extra token and its scan exception have now been
removed in favor of the existing body token. The color checks remain intact.

## Complete client size pass

The client-wide component scan found and removed fixed Tailwind font sizes in
chat, queue controls, browser previews and the browser empty state. Caption
line-height overrides in plan/tool details were removed. Primary right-panel
task/resource labels now use the same interface role as sidebar labels; their
status and timestamp lines remain deliberately secondary.

Shared buttons, fields, segmented options, menu actions and navigation rows use
one minimum-height/padding rule derived from the actual line box. Default text
buttons, fields and icon buttons measure 28px high at the 12px default. Explicit
compact action steps are 20px and 24px; larger actions are 32px. Sidebar action
targets, settings selectors and workspace glyph frames now follow the existing
control scale instead of fixed rem heights. Button spinners follow their label.
The slider hit area, thumb, track and endpoint correction also follow that scale;
the endpoint correction no longer assumes a 14px thumb.

File references inside backticks keep sentence size and the Inter family at
500 weight. Ordinary inline code retains the configured monospace size, with
500 weight for legibility. A file reference has no fabricated click action.
Plan/status marks center in their label's actual line height, while task glyphs
inherit their label's size. The root rem grid stays 16px. Brand artwork, media,
heading hierarchy and the existing 16px coarse-pointer input accommodation have
separate purposes and were retained.

The initial typography regression tests failed against the mismatched prose
scale and fixed font classes. Further negative controls removed the shared
button class and file-reference classification; both corresponding tests failed
before restoration. The source contract now scans all non-test TSX components
for fixed Tailwind font sizes and guards the shared control and inline treatments.

Measured in the development browser using the production components:

| Text setting | Body / filenames | Code | Default button / field / icon button |
| --- | --- | --- | --- |
| 11px | 11px | 10px | 26px |
| 12px | 12px | 11px | 28px |
| 13px | 13px | 12px | 30px |
| 14px | 14px | 13px | 33px |

The menu measured 12px text and a 28px single-line row at default; a row with a
secondary note grew to 44.5px. Filename text measured Inter 500 at 12px. The
slider thumb measured 13px and met both track edges without an offset error.
Both light and dark conversation previews were inspected. These are browser
measurements of representative shared components, not screenshots of every
possible application state.

## Changed files and final checks

- `STUDIO/src/features/chat/markdown/{Markdown,MarkdownLink}.tsx`: user rendering
  mode, safe artifact-fence behavior, web-link preview, citations, external opening.
- `STUDIO/src/features/chat/transcript/CollapsibleText.tsx` and
  `transcript/live/LiveUserMessage.tsx`: Markdown body with existing measurement,
  roomier bubble insets and responsive width.
- `STUDIO/src/features/chat/streaming/segment.ts`: document-context preservation.
- `STUDIO/src/styles/{type,prose,components}.css`, `src/design/RULES.md`, and
  `src/design/tokens/geometry.ts`: shared typography and control sizing.
- Shared `Button`, `TextField`, `NavRow`, `Segmented`, `MenuItem`, and `StepSlider`
  primitives: scalable geometry, line boxes and glyphs.
- Sidebar rows, settings selectors, right-panel task/resource rows, plan marks,
  chat queue labels and browser titles: role and control-scale corrections.
- `STUDIO/src/components/primitives/Popover/Popover.tsx`: optional inline anchor
  and keyboard behavior for prose links; existing menus retain their mode.
- `STUDIO/src/showcase/{Showcase,ConversationSection}.tsx`: actual-renderer
  preview and streamed replay. Existing workspace showcase changes were retained.
- `MarkdownLink.test.tsx`, `StreamedMarkdown.test.tsx`, `segment.test.ts`,
  `LiveUserMessage.test.tsx`, and `tests/typography-contract.test.ts`: rendering,
  file-reference and client-wide typography/control regression coverage.

`pnpm -C STUDIO check` passed type checking, lint, and 1,687 tests in 196 files
after the complete size pass. The preceding conversation-rendering gate passed
1,681 tests in 195 files. The slider regression also failed against its old fixed
thumb before the correction. The production build passed, retaining the existing
large-chunk warning.
`git diff --check` passed. No full baseline before the original rendering task
was recorded.
Harness and native sources were unchanged; their suites were not run for this
client-only change. The showcase video-player chunk failed to load
in this browser session; it was outside the conversation-rendering changes.
