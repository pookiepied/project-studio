import { logger } from "../../logger";
import { ExecutionTarget, LLMToolDefinition, ToolContext, ToolDefinition, ToolGroup, ToolResult, ToolTier } from "./types";

/**
 * Recursively normalizes a JSON Schema for cross-provider compatibility.
 *
 * Converts TypeBox and raw JSON Schema output into the most universally
 * compatible subset accepted by OpenAI, Google (Gemini), Anthropic, Groq,
 * OpenRouter, and every other OpenAI-compatible endpoint.
 *
 * Transformations applied:
 *
 *   1. Strip fields that many providers reject or ignore:
 *      default, minimum, maximum, title, examples, minLength, maxLength,
 *      minItems, maxItems, uniqueItems, format, pattern, patternProperties
 *
 *   2. Convert anyOf:[{const:"A"},{const:"B"}] to enum:["A","B"]
 *      TypeBox's Type.Union(Type.Literal(...)) produces anyOf+const which
 *      Google and Groq reject.  enum is semantically identical and universal.
 *
 *   3. Convert additionalProperties as a schema object to additionalProperties: false
 *      OpenAI accepts schema objects here (for strict mode), but Google and
 *      Groq only accept booleans.  The LLM still sees the description field
 *      on the parent property and generates correct values regardless.
 *
 *   4. Add additionalProperties: false to every object-type node
 *      Required by OpenAI strict mode and newer GPT deployments.  Safe for
 *      all other providers (they treat it as a validation hint).
 *
 *   5. Ensure all object-type nodes have a properties field
 *      Some providers reject {type:"object"} without properties.
 */
function normalizeSchema(schema: any): any {
  if (typeof schema !== "object" || schema === null) return schema;
  if (Array.isArray(schema)) return schema.map(normalizeSchema);

  const STRIP_KEYS = new Set([
    "default",
    "minimum",
    "maximum",
    "title",
    "examples",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "uniqueItems",
    "format",
    "pattern",
    "patternProperties",
  ]);

  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRIP_KEYS.has(key)) {
      continue;
    }

    if (key === "anyOf" && Array.isArray(value)) {
      const allConstStrings = value.every(
        (v: any) =>
          typeof v === "object" &&
          v !== null &&
          v.const !== undefined &&
          typeof v.const === "string"
      );
      if (allConstStrings && value.length > 0) {
        result.enum = value.map((v: any) => v.const);
        continue;
      }
    }

    if (key === "additionalProperties" && typeof value === "object" && value !== null) {
      result.additionalProperties = false;
      continue;
    }

    // Normalize each property's schema but never strip the property name itself —
    // property names like "maxLength" are user-defined identifiers, not JSON Schema
    // keywords, even though they match entries in STRIP_KEYS.
    if (key === "properties" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      const props: any = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, any>)) {
        props[propName] = normalizeSchema(propSchema);
      }
      result.properties = props;
      continue;
    }

    result[key] =
      typeof value === "object" && value !== null
        ? normalizeSchema(value)
        : value;
  }

  if (result.type === "object") {
    if (typeof result.properties !== "object") {
      result.properties = {};
    }
    if (result.additionalProperties === undefined) {
      result.additionalProperties = false;
    }
  }

  return result;
}

/**
 * Abstract base class for all tools.
 *
 * Subclasses must declare:
 *   - name            : unique identifier used in tool calls
 *   - description     : shown to the LLM to decide when to use the tool
 *   - parameters      : JSON Schema object describing accepted arguments
 *   - executionTarget : "cloud" (runs in Worker) or "local" (dispatched to local engine)
 *   - execute()       : the actual implementation
 */
export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: any;
  abstract readonly executionTarget: ExecutionTarget;

  /** Capability domain — drives discovery, filtering, and expand_tools catalog grouping. */
  abstract readonly group: ToolGroup;

  /**
   * Visibility tier.
   *   1 = always in the baseline tool set sent to the LLM.
   *   2 = hidden by default; only surfaced after the LLM calls expand_tools.
   */
  readonly tier: ToolTier = 1;

  /**
   * Whether this tool is available inside sub-agents.
   * Set to false for tools that require client-side execution (task_write)
   * or that must not be nested (spawn_agent).
   */
  readonly allowInSubAgent: boolean = true;

  /**
   * True when this tool's output is already injected into the system prompt
   * as plain text (e.g. current_time). Excluded from all LLM tool definitions
   * to avoid redundancy — the model should not call it directly.
   */
  readonly contextInjected: boolean = false;

  /**
   * When true, this tool is only shown to the LLM when the local engine
   * (Studio Harness) is connected. Maps to the `includeLocal` flag in
   * getContextualDefinitions — the tool is hidden from the schema when
   * the Harness is offline, preventing the LLM from calling it.
   *
   * Use for cloud tools that ultimately need the local engine to work
   * (e.g. Cloud Coding Agents that relay file/shell calls via Harness).
   */
  readonly requiresLocalEngine: boolean = false;

  /**
   * Optional supplementary system prompt co-located with the tool.
   * Injected by expand_tools when this tool's group is returned, so detailed
   * instructions only reach the context window when the tools are actually used.
   * All tools sharing a group should reference the same exported constant.
   */
  readonly groupPrompt?: string;

  abstract execute(args: any, context?: ToolContext): Promise<ToolResult>;

  // ------------------------------------------------------------------
  // Logging helpers
  // ------------------------------------------------------------------

  protected logStart(args: any): void {
    logger.debug(`Tool ${this.name} executing`, { args: this.sanitizeArgs(args) });
  }

  protected logResult(result: any): void {
    logger.debug(`Tool ${this.name} completed`, {
      result: typeof result === "string" ? result.substring(0, 100) : result,
    });
  }

  protected logError(error: any): void {
    logger.error(`Tool ${this.name} failed`, { error });
  }

  /**
   * Strip known sensitive keys from logged args to avoid leaking secrets.
   */
  protected sanitizeArgs(args: any): any {
    const sensitiveKeys = ["apiKey", "token", "password", "secret", "key"];
    const sanitized = { ...args };

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = "***";
      }
    }

    return sanitized;
  }

  // ------------------------------------------------------------------
  // Definition helpers
  // ------------------------------------------------------------------

  /**
   * Returns the plain definition object (name, description, parameters).
   */
  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }

  /**
   * Returns the OpenAI-compatible function definition for inclusion in LLM requests.
   *
   * Normalizes the parameter schema before sending to providers:
   *   - Strips fields that cause INVALID_ARGUMENT on Google/Gemini, Groq, etc.
   *   - Converts anyOf:[{const:...}] to enum (TypeBox Union/Literal pattern)
   *   - Converts additionalProperties schema objects to false (Google only accepts booleans)
   *   - Adds additionalProperties:false to every object node (required by OpenAI strict mode)
   *
   * The resulting schema is the most universally compatible subset accepted by
   * OpenAI, Google, Anthropic, Groq, OpenRouter, and every other provider.
   */
  toLLMDefinition(): LLMToolDefinition {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: normalizeSchema(this.parameters),
      },
    };
  }

  // ------------------------------------------------------------------
  // Result helpers
  // ------------------------------------------------------------------

  protected successResult(result: any): ToolResult {
    return { success: true, result };
  }

  protected errorResult(message: string): ToolResult {
    return { success: false, error: message };
  }
}
