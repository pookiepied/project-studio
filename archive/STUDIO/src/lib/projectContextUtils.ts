/**
 * Utilities for building and detecting project-context blocks.
 *
 * The context is delivered in TWO complementary ways:
 *   1. A system message  — gives agent/tool-aware models explicit routing rules.
 *   2. A user-message prefix — guarantees the LLM sees the context in the
 *      conversational turn itself, which works for local models (where system
 *      messages are stripped before the API call) and for any backend that
 *      overrides or ignores client-provided system messages.
 */

export const PROJECT_CONTEXT_MARKER = "[project-context:";

export interface ProjectContext {
  path: string;
  name: string;
}

/**
 * Compact block prepended to the outgoing *API* user message.
 * Not stored in chat history — only present in the payload sent to the LLM.
 *
 * Kept intentionally short so it doesn't crowd out the user's actual message.
 */
export function buildProjectContextUserBlock(ctx: ProjectContext): string {
  return `${PROJECT_CONTEXT_MARKER} ${ctx.path}]
Active project: ${ctx.name}
Working directory: ${ctx.path}
---`;
}

/**
 * Full system message with project-aware harness tool routing.
 */
export function buildProjectContextSystemPrompt(ctx: ProjectContext): string {
  const { path, name } = ctx;
  return `${PROJECT_CONTEXT_MARKER} ${path}]

The user has shared a project folder for this session.

**Project name:** ${name}
**Project path:** ${path}

Use this path as the working directory for all tasks and questions. When the user asks about files, code, or anything in their project, always reference and use "${path}" as the root. Do not ask the user where their project is — it is already set.

Use direct harness tools:
  mcp_studio_harness__ls("${path}")
  mcp_studio_harness__glob("**/*", "${path}")
  mcp_studio_harness__grep("pattern", { path: "${path}" })
  mcp_studio_harness__read_file("${path}/filename")
  mcp_studio_harness__edit_file({ path: "${path}/filename", old_string, new_string })
  mcp_studio_harness__multi_edit({ edits: [{ path: "${path}/filename", old_string, new_string }] })`;
}
