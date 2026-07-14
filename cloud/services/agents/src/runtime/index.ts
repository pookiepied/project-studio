/**
 * agents/src/runtime — the execution environment for every cloud agent.
 *
 *   types          → AgentRunConfig, AgentState, LLM message/tool shapes, AgentLoopResult
 *   llmClient      → GatewayLLMClient (non-streaming calls to studio-gateway)
 *   loop           → runAgentLoop() — unbounded ReAct loop; optional maxIterations/tokenBudget
 *   agentDO        → BaseAgentDO — the CF Agents SDK DO every agent type extends
 *   modelCatalogue → the curated set of models sub-agents may run on (tier source of truth)
 *
 * Usage: each concrete agent type lives in its own subfolder (e.g. agents/src/agents/research/)
 * and extends BaseAgentDO, declaring SYSTEM_PROMPT and optionally restricting buildToolDescriptors().
 */
export * from "./types";
export * from "./llmClient";
export * from "./loop";
export * from "./agentDO";
export * from "./modelCatalogue";
