# Studio design

Studio uses neutral surfaces, compact controls, and readable content. Chrome uses the same visual roles in the browser and desktop app. Light and dark themes change the values of those roles together.

## Brand

The Studio mark is a six-arm rounded starburst. In the app, `StudioMark` masks the [light-theme SVG](../../STUDIO/public/brand/studio-light.svg) with `--brand-ink`, so it follows the active appearance setting. Use the transparent [dark-theme SVG](../../STUDIO/public/brand/studio-dark.svg) for standalone use on dark surfaces. The [app icon](../../STUDIO/src-tauri/icons/studio-icon.svg) puts the same white starburst on a black rounded square for desktop bundles and the browser favicon. The startup mark eases into place, replays while loading, and appears still under reduced motion.

## Color and interaction

| Role | Shared token | Use |
| --- | --- | --- |
| Canvas and depth | `--surface`, `--surface-sunken`, `--surface-raised` | White and soft gray in light mode, charcoal and lifted graphite in dark mode. |
| Text and icons | `--foreground`, `--muted-foreground` | Use foreground for content and labels. Use muted foreground for supporting copy and quiet icons. |
| Primary action | `--primary`, `--primary-foreground` | Graphite with white text in light mode. Off-white with charcoal text in dark mode. The selected segment of a compact mode control uses the same pair. |
| Edges | `--border` | One neutral hairline around fields or between functional regions. |
| Hover and active item | `--tint`, `--selected` | Neutral hover and a persistent neutral fill for the active tab or row. |
| Accent and keyboard focus | `--accent`, `--ring` | Blue indicates enabled switches, live state, and other compact state indicators. Keyboard focus uses the shared two-pixel blue outline. |
| Text selection | `--selection`, `--selection-foreground` | Neutral gray selection with readable text in both themes. |
| Tooltip | `--tooltip`, `--tooltip-foreground` | Graphite with white text in both themes. |

Use the shared tokens in [palette.css](../../STUDIO/src/styles/palette.css) and the global focus and selection styles in [base.css](../../STUDIO/src/styles/base.css). File types, provider marks, charts, diffs, and warning or destructive states carry their own semantic colors. Use the shared button and icon size scales. The sidebar's filled-side mark and the workspace's tabbed-window mark share the same outer dimensions and stroke weight.

## Workspace

- Keep open files and Studio Browser on one top-level strip of equal-width tabs. Use a file mark or site favicon, a short title, and a close control. The plus opens a new tab with choices for a file or Studio Browser. Drag or use Alt with an arrow key to reorder tabs. Arrow keys, Home, and End switch tabs. Delete closes the current tab.
- Put File actions in the tab strip. Refresh, discussion, native open and reveal, and path copying live in its menu. The Markdown view switch is a single icon floating at the bottom center of the document. Source uses the workspace pane's full width, with a line gutter and syntax highlighting.
- Show the active page title on Studio Browser's workspace tab. Keep the page picker, navigation, and browser-wide control handoff on one toolbar. The Start browser button opens a blank page for that conversation. A connection failure shows a reason and a reconnect action.
- Start browser sessions at a 1280 × 720 viewport. The zoom icon opens a Studio menu for Fit and percentage zoom, which scale the live view locally. Handoffs leave the page viewport and viewer zoom in place. Emphasize the hostname when the address is at rest.
- Show one custom pointer in the browser feed. It follows the person's pointer while they hover the page, and shows Studio's position otherwise. Pressing compresses it and release restores it with a small bounce. During Windows Computer Use, use the same rounded pointer shape as the native cursor with a blue halo while the controlled window has focus. Keep it through keyboard and clipboard actions and restore the user's pointer when control is paused or released. Anchor the computer-use pill to the driver's selected window while that window owns the foreground.
- Chrome DevTools by Studio is opt-in and works in the person's Chrome profile after Chrome grants access. Start work in a dedicated Chrome window. Use a pre-existing tab when the person asks for it. The controlled page uses Studio's blue cursor and a small status pill. Use a blue release pulse to show where Chrome received a click, including when the physical pointer is elsewhere. Remove the decoration when the attachment ends or another tab is selected.
- Reveal Studio Browser when the active conversation first opens or navigates a page in a live turn. Respect a manually hidden workspace for the rest of the window session or until it is opened again. Closing the Browser workspace tab takes it out of automatic reveal for that conversation. Keep the conversation title centered with the workspace closed and aligned to the chat pane when it opens.
- Docked panels share the panel spring for their width. Switching views inside a panel uses the same horizontal handover timing on the left and right. Respect reduced-motion settings.

## Labels and help

- Give every icon-only action an accessible name. Use the shared Tooltip when its purpose needs a hint.
- Visible Settings navigation labels stand on their own. Transcript tool and file-change rows open details on click or keyboard activation. Put the full subject or path in the expanded content.
- Use inline status or error text for action feedback. Use the shared popover for menus and keep feedback available to keyboard and screen reader users.

The [component rules](../../STUDIO/src/design/RULES.md) cover typography, spacing, motion, and control geometry.
