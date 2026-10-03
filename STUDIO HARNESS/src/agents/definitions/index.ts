import { Describe } from "../describe.js";
import { Improve } from "../improve.js";
import { Studio } from "../studio.js";
import { Title } from "../title.js";

import { AgentRegistry, type RegisteredAgent } from "./registry.js";
import { studioDefinition } from "./studio.js";
import { titleDefinition } from "./title.js";
import { improveDefinition } from "./improve.js";
import { describeDefinition } from "./describe.js";

/**
 * The harness's agent registry: every agent the runtime mounts or the
 * application dispatches, resolved by name.
 *
 * Constructed at module load, validated by then, immutable afterwards. A
 * new agent is a definition file plus one line here — that is the whole
 * Stage 2 contract, and the architecture test (agents-registry.test.ts)
 * enforces its other half: nothing outside this folder mounts or dispatches
 * an agent function that this registry does not know.
 *
 * The function-value pairing lives here and only here, because this is the
 * one module where both sides are loaded without a cycle: the definition
 * files import contracts and prompts, never their agent modules, and the
 * agent modules import their definitions for the durability single-source.
 * `dispatch()` resolves by function value, so the registry holding the same
 * object the module exports is the property that keeps dispatch working —
 * the Windows double-bundle bug broke exactly this once, and the
 * `nativeModuleIdentity` plugin plus this file's import of the module
 * object are what keep it broken never.
 */
export const agentRegistry = new AgentRegistry([
  { definition: studioDefinition, agent: Studio },
  { definition: titleDefinition, agent: Title },
  { definition: improveDefinition, agent: Improve },
  { definition: describeDefinition, agent: Describe },
]);

export { AgentRegistry, type RegisteredAgent };
export { validateAgentDefinition, AgentRegistryError, type AgentRegistryErrorKind } from "./registry.js";
export { dispatchBackgroundAgent } from "./dispatch.js";
export { TaskStore, type AgentTaskRecord, type AgentTaskInsertion } from "./task-store.js";
export type {
  StudioAgentDefinition,
  StudioAgentDefinitionInput,
  AgentKind,
  AgentTaskStatus,
  AgentToolPolicy,
  AgentSkillPolicy,
  AgentPermissionPolicy,
  AgentModelPolicy,
  AgentDurabilityPolicy,
} from "../../contracts/agents.js";
