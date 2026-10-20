import { describe, expect, it } from "vitest";

import { agentRegistry } from "../../src/agents/definitions/index.js";
import { EXPLORE_AGENT_ID, GENERAL_AGENT_ID, PLAN_AGENT_ID, STUDIO_AGENT_ID } from "../../src/contracts/agents.js";
import { delegateMount } from "../../src/agents/studio.js";
import { Explore } from "../../src/agents/explore.js";
import { General } from "../../src/agents/general.js";
import { Plan } from "../../src/agents/plan.js";
import {
  actingAgentPolicy,
  effectsWithinCeiling,
  scopeForActingAgent,
  visibleToAgent,
} from "../../src/permissions/agent-policy.js";
import type {
  CapabilityDescriptor,
  ExecutionScope,
} from "../../src/contracts/capabilities.js";
import { NATIVE_PROVENANCE } from "../../src/contracts/capabilities.js";

/** A native descriptor with an effects list, the minimum the policy reads. */
function nativeDescriptor(
  name: string,
  effects: readonly ("read" | "write" | "execute" | "network")[],
): CapabilityDescriptor {
  return {
    id: { namespace: "native", name },
    title: name,
    description: "",
    effects,
    provenance: NATIVE_PROVENANCE,
    idempotent: true,
  };
}

function conversationScope(): ExecutionScope {
  return {
    clientId: "client",
    sessionId: "session",
    agentId: STUDIO_AGENT_ID,
    conversationId: "cnv_test",
    projectId: "prj_test",
  };
}

describe("the acting-agent policy", () => {
  it("answers the conversation agent with no allowlist, no ceiling, no mode override", () => {
    const policy = actingAgentPolicy(undefined, agentRegistry);
    expect(policy.subagentName).toBeUndefined();
    // The conversation agent composes its surface from live state; the
    // policy's answer is "no restriction here" and the gate list passes
    // through.
    expect(policy.allowedNatives).toBeUndefined();
    expect(policy.maxEffects).toBeUndefined();
    // Its default asks resolve under the conversation's own posture — the
    // definition-level mode exists for delegates only.
    expect(policy.mode).toBeUndefined();
  });

  it("resolves the explore delegate's allowlist from the registry", () => {
    const policy = actingAgentPolicy(EXPLORE_AGENT_ID, agentRegistry);
    expect(policy.subagentName).toBe(EXPLORE_AGENT_ID);
    expect([...(policy.allowedNatives ?? [])].sort()).toEqual([
      "fetch",
      "git",
      "glob",
      "grep",
      "read",
      "web_search",
    ]);
    // The corrected D11 reading (Stage 5): read-only on the machine, with
    // the web readers' network effect in scope — a visible tool that could
    // never run was the old ceiling's own lie.
    expect(policy.maxEffects).toEqual(["read", "network"]);
    // The delegate's own consent default, carried for the kernel's posture.
    expect(policy.mode).toBe("inherit");
  });

  it("resolves the general delegate's allowlist: the working set, no destructive pair", () => {
    const policy = actingAgentPolicy(GENERAL_AGENT_ID, agentRegistry);
    expect(policy.subagentName).toBe(GENERAL_AGENT_ID);
    expect([...(policy.allowedNatives ?? [])].sort()).toEqual([
      "edit",
      "fetch",
      "git",
      "glob",
      "grep",
      "read",
      "shell",
      "web_search",
      "write",
    ]);
    // The whole vocabulary: general's story is ask-based, not
    // refusal-based — the destructive pair is withheld by the allowlist,
    // and everything reachable stops at the kernel under its own id.
    expect(policy.maxEffects).toEqual(["read", "write", "execute", "network"]);
    expect(policy.mode).toBe("inherit");
    // The wildcard: "the namespaces this conversation has adopted".
    expect(policy.allowedMcpNamespaces?.has("*")).toBe(true);
  });

  it("resolves the plan delegate's allowlist: readers plus the plan tool", () => {
    const policy = actingAgentPolicy(PLAN_AGENT_ID, agentRegistry);
    expect(policy.subagentName).toBe(PLAN_AGENT_ID);
    expect([...(policy.allowedNatives ?? [])].sort()).toEqual(["glob", "grep", "plan", "read"]);
    expect(policy.maxEffects).toEqual(["read"]);
    // No MCP at all — the strict list, not the star.
    expect(policy.allowedMcpNamespaces?.size).toBe(0);
  });

  it("treats an unregistered name as a delegate allowed nothing", () => {
    // A name on the frame the registry does not know is an authoring bug
    // the architecture test refuses at build time; the runtime answer is
    // most-restrictive, never a pass-through.
    const policy = actingAgentPolicy("ghost", agentRegistry);
    expect(policy.subagentName).toBe("ghost");
    expect(policy.allowedNatives?.size).toBe(0);
    expect(policy.maxEffects).toEqual(["read"]);
  });

  it("shows the conversation agent everything the gate lists", () => {
    const policy = actingAgentPolicy(undefined, agentRegistry);
    expect(visibleToAgent(nativeDescriptor("shell", ["execute"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("discover", ["read"]), policy)).toBe(true);
  });

  it("shows a delegate exactly its allowlist, and never discover", () => {
    const policy = actingAgentPolicy(EXPLORE_AGENT_ID, agentRegistry);
    // The visibility-is-authority rule (D4): the child's model sees the
    // intersection of the definition's list with what the gate holds, and
    // a tool outside it is not in the child's array at all.
    expect(visibleToAgent(nativeDescriptor("read", ["read"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("glob", ["read"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("grep", ["read"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("git", ["read", "write"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("web_search", ["network"]), policy)).toBe(true);
    expect(visibleToAgent(nativeDescriptor("fetch", ["network"]), policy)).toBe(true);
    // Withheld by name, allowlist or no:
    expect(visibleToAgent(nativeDescriptor("discover", ["read"]), policy)).toBe(false);
    // Outside the allowlist:
    expect(visibleToAgent(nativeDescriptor("write", ["write"]), policy)).toBe(false);
    expect(visibleToAgent(nativeDescriptor("shell", ["execute"]), policy)).toBe(false);
    expect(visibleToAgent(nativeDescriptor("ask_user_question", ["read"]), policy)).toBe(false);
    expect(visibleToAgent(nativeDescriptor("plan", ["write"]), policy)).toBe(false);
  });

  it("withholds discover even from a delegate whose allowlist names it", () => {
    // The name-based withhold is not the allowlist's shadow: a definition
    // naming `discover` (a registry-valid name) would pass the allowlist
    // check, and the by-name rule is what still refuses it. The negative
    // control for exactly this: mutate the withhold away and THIS test
    // flips, where the allowlist-only tests above would not notice.
    const policy: ReturnType<typeof actingAgentPolicy> = {
      subagentName: "naming-delegate",
      allowedNatives: new Set(["discover"]),
      allowedMcpNamespaces: new Set<string>(),
      maxEffects: ["read"],
      mode: "ask",
    };
    expect(visibleToAgent(nativeDescriptor("discover", ["read"]), policy)).toBe(false);
  });

  it("hides every MCP namespace a delegate's definition does not name", () => {
    const policy = actingAgentPolicy(EXPLORE_AGENT_ID, agentRegistry);
    const mcpTool: CapabilityDescriptor = {
      id: { namespace: "mcp:some-server", name: "tool" },
      title: "MCP tool",
      description: "",
      effects: ["read"],
      idempotent: true,
      provenance: { origin: "mcp", sourceId: "mcp:some-server", author: "third-party" },
    };
    expect(visibleToAgent(mcpTool, policy)).toBe(false);
  });

  it("shows the star allowlist every adopted namespace, and an empty list none", () => {
    // The general delegate's wildcard: server ids are user-minted, so a
    // static definition cannot name them — `*` says "what this conversation
    // has adopted". The conversation's own enablement chain decides what
    // the gate lists at all; this test pins the delegate-side half of the
    // intersection against a namespace that reaches the gate.
    const general = actingAgentPolicy(GENERAL_AGENT_ID, agentRegistry);
    const mcpTool: CapabilityDescriptor = {
      id: { namespace: "mcp:some-server", name: "tool" },
      title: "MCP tool",
      description: "",
      effects: ["read"],
      idempotent: true,
      provenance: { origin: "mcp", sourceId: "mcp:some-server", author: "third-party" },
    };
    expect(visibleToAgent(mcpTool, general)).toBe(true);
    // The plan delegate names `[]`: nothing MCP is its to see, even adopted.
    const planner = actingAgentPolicy(PLAN_AGENT_ID, agentRegistry);
    expect(visibleToAgent(mcpTool, planner)).toBe(false);
  });

  it("leaves the conversation agent's scope untouched", () => {
    const policy = actingAgentPolicy(undefined, agentRegistry);
    // The same object, not a copy: the conversation's calls ride the
    // scope the sandbox captured, with no allocation and no re-keying.
    const scope = conversationScope();
    expect(scopeForActingAgent(scope, policy)).toBe(scope);
  });

  it("substitutes the delegate's agentId and nothing else", () => {
    // The #49 property, at the scope layer: a delegate's call carries the
    // delegate's agentId, so a standing grant given to `studio` cannot
    // match it in the kernel's grant lookup. Everything else rides
    // unchanged - the delegate shares the parent conversation's
    // containment, so conversation-scoped grants still apply, keyed to
    // the delegate's agent id.
    const scope = conversationScope();
    const policy = actingAgentPolicy(EXPLORE_AGENT_ID, agentRegistry);
    const substituted = scopeForActingAgent(scope, policy);
    expect(substituted.agentId).toBe(EXPLORE_AGENT_ID);
    expect(substituted.conversationId).toBe(scope.conversationId);
    expect(substituted.projectId).toBe(scope.projectId);
    expect(substituted.clientId).toBe(scope.clientId);
    expect(scope.agentId).toBe(STUDIO_AGENT_ID);
  });

  it("holds every effect to the delegate's ceiling", () => {
    const policy = actingAgentPolicy(EXPLORE_AGENT_ID, agentRegistry);
    // Read-only is the three-layer agreement; this is the second layer.
    // A capability's EVERY effect must sit within the ceiling - a mixed
    // read/write capability is a write as far as the ceiling is
    // concerned, because a call to it can earn the write.
    expect(effectsWithinCeiling(nativeDescriptor("read", ["read"]), policy)).toBe(true);
    expect(effectsWithinCeiling(nativeDescriptor("write", ["write"]), policy)).toBe(false);
    expect(effectsWithinCeiling(nativeDescriptor("shell", ["execute"]), policy)).toBe(false);
    expect(effectsWithinCeiling(nativeDescriptor("mixed", ["read", "write"]), policy)).toBe(false);
    // The web readers are the corrected reading: network reads are within
    // the explorer's ceiling, writes and runs are not.
    expect(effectsWithinCeiling(nativeDescriptor("web_search", ["network"]), policy)).toBe(true);
    expect(effectsWithinCeiling(nativeDescriptor("fetch", ["network"]), policy)).toBe(true);
  });

  it("imposes no ceiling on the conversation agent", () => {
    const policy = actingAgentPolicy(undefined, agentRegistry);
    expect(effectsWithinCeiling(nativeDescriptor("shell", ["execute"]), policy)).toBe(true);
  });
});

describe("the delegate mount", () => {
  it("mounts the explore definition with no model override", () => {
    // `{ inherit: true }` MUST arrive as an omitted `model` field: Flue's
    // omitted field is the parent's model, verbatim, and an explicit
    // undefined would be indistinguishable from an override in a
    // text-reading test. The mount is executable, so the assertion can
    // demand the stronger property.
    const entry = agentRegistry.byKind("delegate").find(
      (candidate) => candidate.definition.identity.agentName === EXPLORE_AGENT_ID,
    );
    expect(entry).toBeDefined();
    const mount = delegateMount(entry!);
    expect(mount.name).toBe(EXPLORE_AGENT_ID);
    expect(mount.description).toBe(entry!.definition.identity.description);
    expect(mount.agent).toBe(Explore);
    expect("model" in mount).toBe(false);
    expect("thinkingLevel" in mount).toBe(false);
  });

  it("mounts the general and plan definitions with no model override", () => {
    // The Stage 5 delegates inherit the parent's model like the explorer
    // does: the roster's one rule is that no delegate silently downgrades
    // the model the person chose for the conversation.
    for (const [agentName, agentFunction] of [
      [GENERAL_AGENT_ID, General],
      [PLAN_AGENT_ID, Plan],
    ] as const) {
      const entry = agentRegistry.byKind("delegate").find(
        (candidate) => candidate.definition.identity.agentName === agentName,
      );
      expect(entry).toBeDefined();
      const mount = delegateMount(entry!);
      expect(mount.name).toBe(agentName);
      expect(mount.agent).toBe(agentFunction);
      expect("model" in mount).toBe(false);
      expect("thinkingLevel" in mount).toBe(false);
    }
  });

  it("mounts a pinned model policy as the override fields", () => {
    // A definition that pins a specifier names it on the mount, because
    // `useModel` inside a delegate render is Flue-forbidden and the
    // declaration is the only seat the override has.
    const mount = delegateMount({
      definition: {
        identity: {
          agentName: "pinned",
          description: "A delegate that pins a cheap model.",
        },
        model: { specifier: "project-studio/default", thinkingLevel: "off" },
      },
      agent: () => "unused",
    });
    expect(mount.model).toBe("project-studio/default");
    expect(mount.thinkingLevel).toBe("off");
  });
});
