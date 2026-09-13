# Studio Client

The desktop UI. React 19 + Vite + Tailwind v4 + Tauri v2.

```
pnpm install
pnpm tauri dev     # the real frameless window
pnpm dev           # the same shell in a browser, minus window controls
```

The previous shell is kept alongside at `STUDIO (ON HOLD UI)/`.

## The type scale, and why it decides everything else

One decision sits under the whole interface: **13px UI text, and every text step
names the icon size that belongs beside it.**

| Role | Text | Icon | Used for |
|---|---|---|---|
| micro | 11 | 12 | badges, meta, timestamps |
| caption | 12 | 14 | secondary labels, hints |
| **ui** | **13** | **14** | buttons, menus, sidebar, composer |
| body | 14 | 16 | transcript prose only |
| title | 17 | 20 | section headings |
| display | 28 | - | the home line (serif) |
| code | 12 | - | code blocks, inline code |

Icons trail their text by about a pixel because a glyph is mostly negative
space and an icon is a solid mark: matched by number, the icon looks bigger.
Binding the pair in `design/tokens/typography.ts` removes the judgement call --
a component picks a role and the role already knows both sizes.

13 rather than 14 because Inter has a tall x-height and renders visually larger
than a system UI face at the same nominal size.

Sizes are applied as `--ui-size` and `--code-size` on the root, and every step
in `index.css` is a delta on those. That is what lets the appearance settings
move the whole system without breaking the pairing.

## Where things live

```
src/
  design/       tokens and theme. the source of truth for every value
    tokens/     typography, geometry, motion
    theme/      appearance state, persistence, the root variables
  components/
    icons/      the registry -- one glyph, one concept, enforced
    brand/      the Studio mark
    primitives/ Popover, Dialog, Tooltip, IconButton, Segmented, Button, Field
  domain/       types and data. no React
    conversation/ the conversation record, and the gallery's identity
    turn/       turn settings and the context-window arithmetic
    models/     providers, models, effort, recent picks
    permissions/execution modes
    projects/   projects, source folders, marks
  stores/
    workspace/  projects, conversations, turns
    navigation/ where the user is
  features/
    chat/       composer, transcript, markdown, code, thinking
      gallery/  every artifact the app can draw, as one fixed transcript
    home/ projects/ settings/ palette/
  platform/     the only files that touch the Tauri API
    tauri/      window and native menus
    harness/    the wire contract, the client, the lifecycle events
    store.ts    the one door to a preferences file
  shell/        window, top strip, sidebar, actions menu
```

Two rules worth keeping:

**One glyph, one concept, and it is enforced.** `components/icons/registry.tsx`
throws at startup in development if two concepts share a glyph. It caught a real
collision the day it was written. Four concepts sit close enough to be confused,
so each takes a different metaphor: thinking is a live event, reasoning is a
level on a dial, permission is a shield, models wear provider marks.

**Fonts are bundled.** Inter and Instrument Serif come from `@fontsource`, so a
local-first app makes no network request to render text.

## Where the gallery is

`features/chat/gallery/` holds the one piece of fixed content left: the
artifact gallery, every renderer's output in its finished state, drawn through
the same live transcript components a real reply lands in. It has no composer.
There is no other demo transport; every conversation speaks to the harness.

## What is real, and what is a placeholder

Real: the shell, the composer, the transcript and every renderer in it
(markdown, GFM tables, math, sanitised HTML, syntax-highlighted code), the
thinking block, message actions, editing, forking, retry, auto-scroll,
projects, the sidebar, search, archive with batch delete, appearance settings,
the custom right-click menu, and window-size persistence.

Placeholder: Voice, Personalization, Shortcuts, Account, MCP servers,
Connectors, Browser use, Skills, Hooks, Git, Worktrees, Environments. Each
renders a pane saying what will live in it rather than an empty frame. Adding a
provider is a working form that does not persist yet.
