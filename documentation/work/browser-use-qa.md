# Studio Browser QA exercise

Start the built `STUDIO HARNESS/dist/browser.mjs` with Node. Use newline-delimited JSON-RPC over stdio. Initialize the connection and use one `tools/list` to get the raw names and schemas. No Codex MCP registration or Studio discovery call is required. Run a loopback fixture in a fresh Chromium context, and close the server's stdin after calling `quit`.

## Coverage workflow

| Phase | Tools | Verification |
| --- | --- | --- |
| Open and inspect | `open`, `read_page`, `read_text`, `read_links`, `find`, `screenshot` | Load a fixture with a form, label, link, password field and prompt. Verify the visible outline, password omission, scoped read, link, find result and screenshot. |
| Interact | `type`, `press`, `select`, `hover`, `drag`, `upload`, `dialog`, `click`, `wait_for`, `scroll` | Use synthetic inputs and a disposable upload. Verify field values, file name, key event, hover, drag and drop, prompt response, saved status and scroll position. |
| Diagnose | `console`, `network`, `evaluate`, `viewport` | Check a known local console message and response body. Measure page state and mobile viewport. Send more than 200 benign local requests and confirm that retained request IDs remain unique. |
| Navigate and clean up | `navigate`, `tabs`, `close_tab`, `quit` | Navigate away, read again, refuse the old reference, list tabs and close a real tab. Refuse a missing tab, then end the isolated browser. |

For each command record the exact name and arguments, whether it returned an error, and what state verifies its effect. Label deliberately invalid calls separately. Count wrong-success results as defects even if the MCP call itself returned success.

## 2026-11-20 run

All 24 tools ran against real Chromium and a local fixture. The baseline had 38 calls, one deliberate refusal and one unexpected timeout. In the latter, the operator chose `find`'s first match, which was a container rather than the intended button. The resulting click did not submit the form. The post-fix rerun had 38 calls, 35 successful ordinary or stress calls, and three deliberate refusals. Its fixture checks all passed.

Terra's independent form workflow finished in 12 calls with no error responses. Its deliberately missing selector returned unrelated text with success. An independent 14-call reproduction also showed a successful click reaching the wrong element after a new outline reused the old reference.

Terra's post-fix run finished in 14 calls with 12 expected successes and two deliberate refusals. Its form submitted correctly, and the original field values were present after going back. No unexpected failed calls or wrong-success outcomes occurred in that run.

Confirmed fixes:

- Outline references use fresh IDs across reads, navigations, and tabs. Old IDs are refused with the recovery step instead of silently pointing to another control.
- Outlines use associated form labels and omit password values. `find` ranks actionable controls before structural copies of their labels.
- Scoped text reads give an explicit error when the selector is missing.
- One dialog handler consumes the latest saved response plan once. Without a plan, it dismisses the dialog.
- Network IDs stay unique as the bounded log rolls over. Evicting an entry also evicts its retained response body.
- Closing a missing tab returns an explicit refusal with instructions to list open tabs.

## Readiness decision

The Browser MCP contract passed on a local fixture with real Chromium. Studio's live-view integration tests are a separate check of input handoff and viewport state. This exercise did not measure failure rates across production conversations, arbitrary websites, or authenticated workflows.

The Computer Use contract covered all 30 tools with a synthetic driver. Its two refusals in 63 calls were intentional. The independent reviewer also saw one setup refusal for opening before the first look, then recovered. A pass on an isolated native Windows desktop is still needed for actual Paint and Notepad interaction, accessibility patterns, the approved clipboard path, and desktop focus and cursor behavior.
