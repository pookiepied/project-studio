/**
 * The one module in STUDIO that speaks HTTP.
 *
 * It talks to the STUDIO HARNESS, a separate local process listening on
 * 127.0.0.1 whose address and bearer credential arrive from `connection.ts`.
 * Routes are mounted by `STUDIO HARNESS/src/transport/http/create-app.ts`,
 * and every one of them sits behind the admission middleware plus a scope
 * check.
 *
 * Three deliberate shapes:
 *
 * 1. Failures are values, not exceptions. Every method returns a
 *    `HarnessResult`, so a settings pane can render "harness not running"
 *    without an error boundary and without a try block.
 * 2. Nothing is trusted because TypeScript described it. Every response body
 *    goes through a parser from `contracts/`, and a body that does not match
 *    is a `malformed-response` failure rather than a value.
 * 3. No retries. A local process that does not answer is a fact to show the
 *    user, not a thing to hammer — a retry loop against a dead loopback port
 *    only delays the truth.
 *
 * The client is one object with every route on it, assembled from one file
 * per mount: `request.ts` is the request itself, and each of the others is
 * the methods of one part of the API, written against the two request shapes.
 */

import { conversationIndexClient, type ConversationIndexClient } from './conversations'
import { decisionClient, type DecisionClient } from './decisions'
import { mcpClient, type McpClient } from './mcp'
import { mediaClient, type MediaClient } from './media'
import { projectClient, type ProjectClient } from './projects'
import { providerClient, type ProviderClient } from './providers'
import { createRequester, type HarnessClientOptions } from './request'
import { skillClient, type SkillClient } from './skills'
import { commandClient, type CommandClient } from './commands'
import { libraryClient, type LibraryClient } from './library'
import { documentClient, type DocumentClient } from './documents'
import { taskClient, type TaskClient } from './tasks'
import { agentClient, type AgentClient } from './agents'
import { diagnosticClient, type DiagnosticClient } from './diagnostics'

export type {
  HarnessAddress,
  HarnessClientOptions,
  HarnessFailure,
  HarnessResult,
} from './request'
export type { ManualModelInput } from './providers'
export { libraryBytesPath, type LibraryQuery, type LibraryAddition } from './library'
export type { DocumentUpload } from './documents'

export interface HarnessClient
  extends ProviderClient,
    McpClient,
    SkillClient,
    CommandClient,
    LibraryClient,
    DocumentClient,
    MediaClient,
    ConversationIndexClient,
    DecisionClient,
    ProjectClient,
    TaskClient,
    AgentClient,
    DiagnosticClient {}

export function createHarnessClient(options: HarnessClientOptions): HarnessClient {
  const request = createRequester(options)
  return {
    ...providerClient(request),
    ...mcpClient(request),
    ...skillClient(request),
    ...commandClient(request),
    ...libraryClient(request),
    ...documentClient(request),
    ...mediaClient(request),
    ...conversationIndexClient(request),
    ...decisionClient(request),
    ...projectClient(request),
    ...taskClient(request),
    ...agentClient(request),
    ...diagnosticClient(request),
  }
}
