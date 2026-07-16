# Studio Taskbar, Dock, Coding Agent, CLI Bridge, and UI Refinement

Please address all of the following issues in the current Studio application. Do not treat this as a simple visual cleanup. Several items affect component architecture, process management, persistence, interaction design, and product direction.

Before changing anything, inspect the existing implementation and identify the components, state stores, window layers, process managers, and style rules involved. Preserve existing working functionality and perform a regression review after implementation.

---

# Part 1: Replace the capsule-shaped taskbar

The current taskbar still uses a large capsule-shaped container. This is not the intended design.

Individual tabs may remain rounded, but the taskbar itself should not look like one large rounded capsule.

Redesign the taskbar so that:

* The taskbar container is flat, minimal, and integrated into the application surface.
* Individual tabs may use restrained rounded corners.
* The taskbar does not resemble a large floating pill.
* The active tab remains visually clear.
* Hover, active, loading, and drag states remain easy to distinguish.
* The taskbar aligns properly with the rest of the interface.
* The design works consistently in light and dark modes.

The taskbar should feel like an application-level tab strip rather than a floating toolbar.

---

# Part 2: Remove the current tab preview implementation

The existing hover preview is not useful and does not accurately represent the tab content.

Remove the current screenshot-style or mirrored preview system.

Replace it with a lightweight informational hover card similar to the small status UI used by Studio when it displays information such as:

* New composition.
* No project selected.
* Current workspace.
* Current environment.

The new tab hover card should display information relevant to the tab type.

Examples:

## Studio tab

* Current project or composition.
* Current workspace.
* Whether a project is selected.
* Current conversation, when relevant.

## OpenCode tab

* Project name.
* Working directory.
* Branch.
* Session status.
* Whether the process is active or idle.

## Cloud Code or CLI Bridge tab

* Cloud environment name.
* Active session.
* Usage status, when available.
* Connection state.

## Coding Agent tab

* Agent name or session title.
* Project.
* Current task status.
* Execution environment.

The card should:

* Appear next to the hovered tab.
* Use a consistent compact design.
* Avoid rendering an inaccurate live preview.
* Close immediately when the pointer leaves.
* Reposition when close to a screen edge.
* Use accessible keyboard and focus behavior.

---

# Part 3: Add a transition when switching tabs

Switching between tabs currently feels delayed because the destination view takes time to prepare.

Add a subtle preload or transition state during tab switching.

The transition should:

* Begin immediately after selecting a tab.
* Confirm visually that the selection was received.
* Prevent the interface from appearing frozen.
* Use a smooth, restrained animation.
* Avoid unnecessarily delaying content that is already available.
* Stop as soon as the selected view is ready.
* Avoid replaying expensive entrance animations on every switch.

Use a transition such as:

* A small progress indicator in the selected tab.
* A short opacity transition.
* A lightweight skeleton or loading surface.
* A brief crossfade between cached views.

Do not use a long or distracting loading animation.

Where possible, preserve mounted tab state so switching does not require rebuilding the complete view every time.

---

# Part 4: Fix OpenCode light-mode support

OpenCode currently remains dark even when Studio is using light mode.

This requires a definitive technical answer and implementation.

## Required investigation

Determine whether OpenCode is rendered as:

* A native Studio component.
* An iframe.
* A webview.
* An embedded browser surface.
* A terminal renderer.
* A separate process with its own frontend.
* A remote application.

## Expected implementation

If OpenCode exposes theme settings, CSS variables, configuration, runtime commands, URL parameters, or an API, synchronize it with the Studio theme.

Studio should pass at least:

* Active theme.
* Background color.
* Foreground color.
* Border color.
* Muted surface color.
* Accent color.
* Terminal or editor theme.

Theme changes should update without restarting the session where technically possible.

## Required answer

If OpenCode cannot support light mode because its embedded client is hard-coded, externally controlled, or exposes no theming interface, state that clearly in the final report.

Do not silently leave the issue unresolved.

In that case, document:

* Why it cannot currently be themed.
* Whether the limitation is in Studio or OpenCode.
* The closest available workaround.
* Whether a custom OpenCode frontend or injected theme layer would be required.

---

# Part 5: Fix OpenCode and Cloud Code corner rounding

The OpenCode and Cloud Code mini-window surfaces are not clipped correctly.

At present, only the top-left corner appears rounded. The following corners are not consistently rounded:

* Top-right.
* Bottom-left.
* Bottom-right.

Fix the complete window surface so all four corners use the same radius.

Inspect all relevant layers, including:

* Parent container.
* Content surface.
* Webview or iframe.
* Loading surface.
* Terminal canvas.
* Overlay elements.
* Scroll container.
* Resize handles.
* Focus outline.
* Process placeholder.

The parent should apply the intended corner radius and clip child content correctly.

Avoid solving only the visible background while allowing an iframe, canvas, or webview to overflow through the corners.

---

# Part 6: Restore the main application outline

The main Studio window previously had a subtle but visible outline. It is now either missing or too thin to perceive.

Restore the intended outline around normal application windows.

The outline should:

* Remain subtle but clearly visible.
* Work in light and dark modes.
* Match the intended application design.
* Remain continuous around every edge.
* Respect the window radius.
* Avoid duplicate borders.
* Avoid being clipped by child content.
* Exclude Pulse and other floating transparent widgets.

Do not apply this outline globally to every root surface.

Create explicit window surface types if they do not already exist:

* Main application window.
* Standard secondary window.
* Embedded mini-window.
* Floating utility widget.
* Transparent overlay.

---

# Part 7: Show the application outline during preload and refresh

The main window outline should be visible from the first rendered frame, including:

* Initial launch.
* Preload.
* Refresh.
* Hydration.
* Route restoration.
* Fully loaded state.

Currently, the outline only appears after the main application has loaded.

Move the essential frame styling into the earliest available rendering layer, such as:

* The static application shell.
* The native window root.
* The preload document.
* The initial HTML and CSS.
* A persistent root wrapper rendered before application hydration.

Avoid a visible flash where the outline appears late.

Pulse and other transparent windows must remain excluded.

---

# Part 8: Remove tab groups and the three-dot tab menu

Remove the tab-group functionality.

Also remove the three-dot menu currently associated with the tab interface if its primary purpose is tab grouping or other unnecessary tab actions.

Delete:

* Create Group.
* Group management UI.
* Group-specific state.
* Group persistence.
* Group menu items.
* Dead code related only to grouping.

Do not leave hidden or unreachable group functionality in the codebase.

---

# Part 9: Add tab reordering

Tabs other than the fixed Studio tab should be reorderable.

For example, users should be able to move:

* OpenCode before Cloud Code.
* Cloud Code after a Coding Agent.
* One coding session before another.

The Studio tab may remain pinned in its fixed position.

Required behavior:

* Drag tabs horizontally.
* Show a clear insertion position.
* Preserve the active tab during reordering.
* Prevent the Studio tab from being displaced.
* Persist the resulting order.
* Restore the saved order after refresh.
* Support mouse and pointer interactions.
* Provide a keyboard-accessible alternative where practical.
* Avoid accidental process restarts or tab remounting during reorder.

Tab order should be changed in the state model, not merely through a temporary visual transform.

---

# Part 10: Hide the alignment containers while preserving their layout behavior

The current implementation appears to use visible boxes, outlines, or containers around the left-side and right-side toolbar controls.

These containers seem to be helping maintain correct horizontal alignment, which is useful. However, the visible outline or box should not remain.

Preserve the structural layout but hide the visual container.

The containers should:

* Continue controlling spacing and vertical alignment.
* Remain part of the layout system.
* Have no visible background or border unless required for a deliberate design state.
* Avoid affecting the hit area of unrelated controls.
* Avoid creating an unintended floating-panel appearance.

This should preserve the current horizontal symmetry without exposing the implementation container visually.

---

# Part 11: Use one global dock only

The application currently has multiple dock implementations:

* A general dock shown across ordinary pages.
* A separate dock used on the chat page.

Remove the duplicate chat-specific dock.

There should be one shared global dock component that is mounted consistently across the application.

The global dock should:

* Use the same component and state everywhere.
* Remain mounted across route changes where possible.
* Avoid disappearing and reappearing when entering chat.
* Avoid shifting the page layout.
* Avoid resetting its state unnecessarily.
* Use context-aware actions without becoming a separate component.

Remove the conversation icon from the dock.

The conversation page already represents the active conversation, so that icon is redundant.

---

# Part 12: Move conversation metadata out of the removed chat dock

The existing chat dock currently contains useful information such as:

* Conversation title.
* Selected project.
* Current branch.
* Context-window usage.
* Cloud usage or CLI Bridge usage.
* Environment information.

Do not remove this information when deleting the chat-specific dock.

Render this metadata directly in the chat interface, in the same central top region where it currently appears.

The metadata display should not be another dock.

It should be a lightweight conversation header that can include:

* Conversation title.
* Project folder.
* Branch.
* Context usage.
* Environment.
* Cloud or CLI usage.
* Relevant session status.

The information should remain independent of whether the global dock is expanded.

---

# Part 13: Add a collapsible global dock

The single global dock should be collapsible.

Use a small persistent handle or chevron control inspired by compact system-tray reveal controls.

## Collapsed state

When collapsed:

* The dock actions are hidden.
* The central conversation metadata remains visible.
* A small reveal control remains accessible.
* The text input and conversation layout do not shift.

## Expanded state

When expanded:

* The dock appears using a smooth transition.
* The conversation metadata may temporarily move, fade, or reduce if needed.
* The expansion should not cause abrupt page reflow.
* The dock should appear as an overlay or within permanently reserved space.

Clicking the control again should collapse it.

The control should not resemble a large purple arrow. It should be subtle, neutral, and consistent with the application design.

Persist the user’s expanded or collapsed preference.

---

# Part 14: Prevent the taskbar from shifting the text input

The taskbar currently appears only after a coding agent or CLI session is created. When it appears, it changes the position of the text field.

This is not acceptable because the text input should remain spatially stable.

## Recommended solution

Reserve the taskbar region in the layout at all times.

When there are no task tabs:

* Keep the region visually empty.
* Do not show the full taskbar.
* Preserve its height in the layout.
* Optionally show a subtle activation handle only when useful.

When tabs exist:

* Render the taskbar inside the already reserved space.
* Animate its opacity or content.
* Do not move the text field.

Do not implement a Windows-style hover-only taskbar if that would make the interface difficult to discover or cause accidental activation.

The taskbar may auto-hide visually, but its layout footprint should remain stable.

---

# Part 15: Fix search and command-palette layering

Clicking the search button opens the command palette and applies a blurred overlay.

In light mode, the blur appears to interact incorrectly with:

* Left sidebar controls.
* Back and forward buttons.
* Search control.
* Global dock.
* Environment selector.
* Open in App.
* Open Coding Agent.
* Workspace toggle.

These controls appear through the blur in an awkward way, suggesting either:

* The overlay is below some toolbar layers.
* The toolbar surfaces are transparent.
* The blur is applied to the wrong stacking context.
* The overlay and dock use unrelated portals.
* Incorrect `z-index` values are being used.

Fix the stacking architecture.

The command palette should:

* Render above the complete application chrome.
* Apply one consistent backdrop.
* Blur and dim the underlying interface uniformly.
* Prevent interaction with the background.
* Avoid leaving unrelated controls visually sharp above the overlay.
* Continue closing correctly with Escape.

Audit:

* Portals.
* Stacking contexts.
* `z-index`.
* `position`.
* `transform`.
* `filter`.
* `backdrop-filter`.
* Native window layers.
* Webview layers.

Do not simply increase one arbitrary `z-index` without understanding the layer structure.

---

# Part 16: Improve the command palette content

The command palette currently contains actions, but it should also become a useful navigation surface.

Add quick navigation options such as:

* Recent conversations.
* Recent projects.
* Open settings.
* Open workspace.
* Start a new conversation.
* Open Coding Agent.
* Switch local or cloud environment.
* Open a recent file or session, where supported.

Organize results into clear sections:

* Actions.
* Conversations.
* Projects.
* Navigation.
* Settings.

Support fuzzy search and keyboard navigation.

Do not overload the palette with every possible action. Prioritize frequently used destinations.

---

# Part 17: Fix the “Open Coding Agent” project-selection modal

When the user clicks the plus button or Open Coding Agent while not inside a project, the project-selection UI appears in the top-right corner.

It should appear centered.

Reuse the existing centered permission or trust-dialog pattern used elsewhere in Studio, including the visual treatment associated with assets such as `sky.png` or `moon.png`, where appropriate.

The dialog should:

* Appear in the center of the application.
* Use a full-screen backdrop.
* Match the existing trust or permission UI.
* Be accessible by keyboard.
* Close with Escape where appropriate.
* Avoid being attached to the triggering button as a small popover.

The dialog should offer options such as:

* Select a project folder.
* Use the default location.
* Cancel.

Only show this dialog when no project context exists.

---

# Part 18: Automatically use the active project

When the user is already inside a selected project, creating a coding agent or CLI session should automatically use that project.

Do not ask the user to select a project folder again.

The resolution order should be:

1. Explicit project selected by the user for this action.
2. Active project associated with the current conversation.
3. Current workspace project.
4. Previously confirmed default working directory.
5. Project-selection dialog.

The selected directory should be shown in the created tab or session details.

Do not silently use an unrelated process-level current working directory.

---

# Part 19: Product decision — Coding Agent versus CLI Bridge

There are currently overlapping systems:

* Open Coding Agent.
* Cloud Code or CLI Bridge.
* Direct CLI or PowerShell-based sessions.
* Cloud agent execution.

These should not remain as several competing primary products.

## Recommended product architecture

Keep both the Coding Agent and CLI Bridge, but give them different responsibilities.

### Coding Agent should be the primary product

The Coding Agent should be the normal user-facing workflow for intelligent coding tasks.

It should handle:

* User instructions.
* Planning.
* File reading and editing.
* Tool selection.
* Task progress.
* Permission requests.
* Validation.
* Results.
* Local or cloud execution selection.

### CLI Bridge should become an execution capability

The CLI Bridge should not act as a second competing coding agent.

It should provide:

* Native shell access.
* Process creation.
* Terminal streaming.
* Working-directory management.
* Environment variables.
* Process cancellation.
* Remote shell connectivity where supported.
* A direct terminal mode for advanced users.

The Coding Agent may use the CLI Bridge as one of its tools.

### Cloud agent should remain an execution environment

Cloud agent execution is not a duplicate of the Coding Agent.

The Coding Agent is the workflow and intelligence layer.

Local and cloud are execution targets.

The product model should therefore be:

**Coding Agent → local runtime or cloud runtime → optional CLI Bridge or native tools**

Do not present “Coding Agent,” “CLI Bridge,” and “Cloud Agent” as three equivalent user choices when their responsibilities differ.

## Recommended UI

Primary action:

* Open Coding Agent.

Advanced actions:

* Open Terminal.
* Open CLI Bridge.
* Run in Cloud.
* Run Locally.

The CLI Bridge may remain directly accessible for advanced users, debugging, or manual terminal work.

---

# Part 20: Shared native capabilities for coding sessions

Coding sessions should share a common native session layer instead of every tab independently implementing its own process behavior.

Create a shared coding-session service that provides:

* Project directory.
* Process lifecycle.
* Shell environment.
* File-system permissions.
* Session identifier.
* Agent identifier.
* Runtime selection.
* Terminal output stream.
* Cancellation.
* Suspend and resume behavior.
* Session activity state.
* Resource usage.
* Last-active timestamp.
* Persistence metadata.

A Coding Agent, direct terminal, OpenCode instance, or Cloud Code session may attach different interfaces to this common session model.

Do not force every interface to duplicate process management, project resolution, and lifecycle logic.

---

# Part 21: Multiple Coding Agent sessions and resource management

Creating many Coding Agent or PowerShell sessions may eventually consume excessive:

* RAM.
* CPU.
* Process handles.
* Terminal buffers.
* WebSocket connections.
* File watchers.
* Language-server instances.
* Background tool processes.
* Cloud resources.

This should not be assumed to be safe without investigation.

## Required audit

Determine whether each new agent tab currently starts:

* A separate operating-system process.
* A separate shell.
* A separate OpenCode process.
* A separate language server.
* A separate agent loop.
* A separate file watcher.
* A separate websocket.
* A separate browser or webview instance.
* A separate remote cloud environment.

Measure or inspect the lifecycle of these resources.

## Required session manager

Introduce a centralized session manager with:

* Maximum active local sessions.
* Maximum active cloud sessions.
* Idle-session suspension.
* Explicit session termination.
* Cleanup when a tab closes.
* Cleanup when a project closes.
* Cleanup after crashes.
* Deduplication of shared language servers where safe.
* Deduplication of file watchers where safe.
* Bounded terminal output buffers.
* Lazy loading of inactive views.
* Process health checks.
* Resource usage reporting.
* Recovery of persisted session metadata without blindly restarting every process.

Inactive tabs should not necessarily retain a fully active rendered webview or terminal.

## Recommended behavior

* Keep active sessions running while they are performing work.
* Suspend or reduce inactive UI rendering.
* Prompt before terminating a session with an active task.
* Automatically clean up abandoned idle sessions according to a configurable policy.
* Never restore dozens of heavy processes automatically after restart without user intent.

The final report must explain the current resource model and the implemented limits.

---

# Part 22: Local, project, and conversation behavior

The Open Coding Agent action should behave according to context.

## Inside an active project

* Open directly in that project.
* Do not show a project picker.
* Use the project’s current branch and environment.
* Create a new tab or focus a compatible existing session based on the requested behavior.

## Inside a conversation associated with a project

* Use that conversation’s project.
* Show the selected path in the session metadata.

## Inside a conversation without a project

* Show the centered project-selection dialog.
* Allow selection of a project or default location.

## Outside a conversation and without a project

* Show the same centered project-selection dialog.

This logic should be implemented once in a shared project-context resolver.

---

# Part 23: Top-bar alignment and chrome consistency

The following elements must continue to share one horizontal center line:

* Left sidebar toggle.
* Back.
* Forward.
* Search.
* Global dock.
* Environment selector.
* Open in App.
* Open Coding Agent.
* Workspace toggle.

Retain the structural wrappers currently helping with alignment, but remove their visible outlines.

Check alignment in:

* Light mode.
* Dark mode.
* Chat.
* Project pages.
* Empty states.
* OpenCode.
* Cloud Code.
* Different window sizes.
* Different display scaling values.

Avoid individual `top`, `margin-top`, and `translateY` hacks.

---

# Part 24: Implementation sequence

## Phase 1: Audit

Inspect:

* Taskbar and tab components.
* Current preview implementation.
* Tab state and persistence.
* Dock implementations.
* Conversation header.
* OpenCode embedding.
* Theme propagation.
* Window frame styling.
* Preload shell.
* Command palette portal and layering.
* Project-context resolution.
* Coding Agent session creation.
* CLI Bridge lifecycle.
* Local and cloud process managers.

Document the findings before major refactoring.

## Phase 2: Architecture

Define:

* One global dock.
* One taskbar model.
* Fixed and reorderable tabs.
* Shared coding-session service.
* Project-context resolution rules.
* Window surface variants.
* Command-palette layer hierarchy.
* Resource-management policy.
* Coding Agent and CLI Bridge responsibility boundaries.

## Phase 3: Visual and interaction fixes

Implement:

* Flat taskbar container.
* Informational tab hover cards.
* Tab-switch transition.
* Full corner clipping.
* Restored window outline.
* Preload outline.
* Hidden alignment wrappers.
* Centered project dialog.
* Correct palette blur and layering.
* Improved palette navigation.
* Collapsible global dock.
* Stable text-input positioning.

## Phase 4: Functional changes

Implement:

* Remove tab groups.
* Remove the tab three-dot menu.
* Reorder tabs.
* Persist tab order.
* Automatically resolve active projects.
* Shared session management.
* Resource cleanup.
* Local and cloud execution routing.
* Light-mode synchronization for OpenCode where supported.

## Phase 5: Validation

Test:

* Fresh launch.
* Refresh.
* Light mode.
* Dark mode.
* Project selected.
* No project selected.
* Conversation with project.
* Conversation without project.
* Multiple Coding Agent sessions.
* Multiple terminal sessions.
* Multiple OpenCode tabs.
* Local runtime.
* Cloud runtime.
* Tab dragging.
* Tab restoration.
* Dock expansion and collapse.
* Command palette.
* Escape behavior.
* Window resizing.
* Display scaling.
* Process cleanup.
* App shutdown and restart.

---

# Part 25: Required answers in the final implementation report

The final report must answer every question below directly.

1. Can OpenCode technically support Studio light mode?

2. If yes, how was theme synchronization implemented?

3. If no, what exact limitation prevents it?

4. Should Coding Agent and CLI Bridge both remain?

5. What is the final responsibility of each one?

6. Is Cloud Agent a separate product or an execution environment?

7. What native functionality is shared between Coding Agent, CLI Bridge, OpenCode, and terminal sessions?

8. What happens when many Coding Agent sessions are created?

9. How many active sessions are allowed?

10. How are idle sessions suspended or terminated?

11. What processes, watchers, sockets, language servers, or webviews does each session create?

12. How is RAM and CPU usage controlled?

13. When does the project-selection dialog appear?

14. How is the active project resolved automatically?

15. Why was a reserved taskbar region chosen instead of allowing the text field to move?

16. How is tab order persisted?

17. Why is the Studio tab fixed?

18. Where is conversation metadata displayed after removing the chat-specific dock?

19. How does the global dock expand and collapse without shifting the chat layout?

20. How was the command-palette stacking and blur issue corrected?

21. Which files and components were changed?

22. What checks, tests, builds, and regression reviews were completed?

Do not replace these answers with a generic summary of completed work.

---

# Final product decisions

Unless the existing implementation reveals a serious technical restriction, use the following decisions:

* Replace the capsule-shaped taskbar with a flat taskbar.
* Keep rounded individual tabs.
* Remove inaccurate tab previews.
* Use compact informational hover cards.
* Add a lightweight tab-switch transition.
* Remove tab groups.
* Remove the three-dot tab menu.
* Keep Studio fixed.
* Allow other tabs to be reordered.
* Use one global dock.
* Remove the conversation icon from the dock.
* Render conversation metadata directly in the chat header.
* Show the global dock on every standard page except chat.
* On chat, show conversation metadata by default and hide the global dock.
* Use one independent up/down caret in the title bar to swap chat metadata and the global dock.
* Keep the caret outside the dock; do not add a second dock or chat-specific navigation implementation.
* Keep the text field stationary by reserving taskbar space.
* Center the project-selection modal.
* Automatically use the active project.
* Keep both Coding Agent and CLI Bridge.
* Make Coding Agent the primary workflow.
* Make CLI Bridge an advanced terminal and execution capability.
* Treat local and cloud as execution targets.
* Add a centralized coding-session manager.
* Add explicit resource limits and cleanup.
* Restore the application outline.
* Render the outline during preload.
* Exclude transparent floating widgets from normal window framing.
* Fix OpenCode and Cloud Code clipping on all four corners.
* Fix command-palette layering across the complete application chrome.

---

# Part 26: Chat dock correction and regression result

The chat header uses the same `FloatingPanelNavigation` instance as every other
standard page. The old chat-specific dock component has no render path and is
removed. On chat, conversation metadata is the default center content. The
independent title-bar caret swaps that metadata with the global dock. Leaving
chat resets the swap state so returning to chat remains predictable.

Dock category menus use the original navigation state and outside-click
behavior. Their popup failure was caused by an animated `overflow-hidden`
wrapper around the global dock; that wrapper was removed so menus can render
below the title bar again.

The swap affects only title-bar content. It does not change document flow,
taskbar reservation, or composer position.

Validation completed for this correction:

* Focused ESLint checks passed.
* TypeScript type checking passed.
* Production build passed.
* Circular-import ratchet passed with zero cycles.
* Diff whitespace checking passed.
* Repository-wide lint still reports ten unrelated design-system violations in
  existing artifact-renderer files; none are in the dock or chat chrome paths.
