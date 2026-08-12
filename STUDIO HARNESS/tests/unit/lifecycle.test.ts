import { describe, expect, it } from "vitest";

import {
  type LifecycleEvent,
  type LifecycleState,
  transition,
} from "../../src/extend/mcp/wire/lifecycle.js";

function idle(): LifecycleState {
  return { kind: "idle" };
}
function starting(attempts = 0): LifecycleState {
  return { kind: "starting", attempts };
}
function ready(): LifecycleState {
  return { kind: "ready" };
}
function stopping(): LifecycleState {
  return { kind: "stopping" };
}
function failed(attempts: number): LifecycleState {
  return { kind: "failed", attempts };
}
function givenUp(): LifecycleState {
  return { kind: "given-up" };
}

describe("lifecycle state machine", () => {
  describe("legal transitions", () => {
    it("idle --start--> starting", () => {
      const result = transition(idle(), { kind: "start" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(starting(0));
    });

    it("starting --started--> ready", () => {
      const result = transition(starting(), { kind: "started" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(ready());
    });

    it("starting --failed--> failed with incremented attempts", () => {
      const first = transition(starting(0), { kind: "failed" });
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.state).toEqual(failed(1));

      const second = transition(starting(2), { kind: "failed" });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.state).toEqual(failed(3));
    });

    it("ready --stop--> stopping", () => {
      const result = transition(ready(), { kind: "stop" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(stopping());
    });

    it("ready --failed--> failed with attempts 1", () => {
      const result = transition(ready(), { kind: "failed" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(failed(1));
    });

    it("stopping --stopped--> idle", () => {
      const result = transition(stopping(), { kind: "stopped" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(idle());
    });

    it("failed --start--> starting preserves attempt count", () => {
      const result = transition(failed(2), { kind: "start" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(starting(2));
    });

    it("failed --giveUp--> given-up", () => {
      const result = transition(failed(5), { kind: "giveUp" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(givenUp());
    });

    it("given-up --restart--> idle", () => {
      const result = transition(givenUp(), { kind: "restart" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toEqual(idle());
    });

    it("carries attempt count through a retry cycle", () => {
      // idle -> starting(0) -> failed(1) -> starting(1) -> failed(2) -> given-up
      const s1 = transition(idle(), { kind: "start" });
      expect(s1.ok).toBe(true);
      if (!s1.ok) return;
      const f1 = transition(s1.state, { kind: "failed" });
      expect(f1.ok).toBe(true);
      if (!f1.ok) return;
      expect(f1.state).toEqual(failed(1));

      const s2 = transition(f1.state, { kind: "start" });
      expect(s2.ok).toBe(true);
      if (!s2.ok) return;
      const f2 = transition(s2.state, { kind: "failed" });
      expect(f2.ok).toBe(true);
      if (!f2.ok) return;
      expect(f2.state).toEqual(failed(2));

      const g = transition(f2.state, { kind: "giveUp" });
      expect(g.ok).toBe(true);
      if (g.ok) expect(g.state).toEqual(givenUp());
    });
  });

  describe("illegal transitions are refused", () => {
    it("refuses ready from stopping", () => {
      // The bug that leaves two processes running: stopping -> ready
      const result = transition(stopping(), { kind: "started" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/Cannot started from stopping/);
    });

    it("refuses starting entered twice", () => {
      const result = transition(starting(), { kind: "start" });
      expect(result.ok).toBe(false);
    });

    it("refuses every illegal state/event pair", () => {
      // The legal set as a table — so a new state cannot be added without
      // deciding its transitions, and every pair not in the table is refused.
      const legal = new Set<string>([
        "idle:start",
        "starting:started",
        "starting:failed",
        "ready:stop",
        "ready:failed",
        "stopping:stopped",
        "failed:start",
        "failed:giveUp",
        "given-up:restart",
      ]);

      const states: LifecycleState[] = [
        idle(),
        starting(),
        ready(),
        stopping(),
        failed(1),
        givenUp(),
      ];
      const events: LifecycleEvent[] = [
        { kind: "start" },
        { kind: "started" },
        { kind: "stop" },
        { kind: "stopped" },
        { kind: "failed" },
        { kind: "giveUp" },
        { kind: "restart" },
      ];

      for (const state of states) {
        for (const event of events) {
          const key = `${state.kind}:${event.kind}`;
          const result = transition(state, event);
          if (legal.has(key)) {
            expect(result.ok, `${key} should be legal`).toBe(true);
          } else {
            expect(result.ok, `${key} should be refused`).toBe(false);
            if (!result.ok) {
              expect(result.reason).toMatch(/Cannot/);
            }
          }
        }
      }
    });

    it("refuses a transition as a returned result, not a thrown error", () => {
      expect(() => transition(idle(), { kind: "started" })).not.toThrow();
      const result = transition(idle(), { kind: "started" });
      expect(result.ok).toBe(false);
    });
  });

  describe("failed and given-up semantics", () => {
    it("failed carries the attempt count", () => {
      const result = transition(starting(3), { kind: "failed" });
      expect(result.ok).toBe(true);
      if (result.ok && result.state.kind === "failed") {
        expect(result.state.attempts).toBe(4);
      }
    });

    it("given-up holds no attempt count and only leaves via restart", () => {
      const fromFailed = transition(failed(5), { kind: "giveUp" });
      expect(fromFailed.ok).toBe(true);
      if (!fromFailed.ok) return;
      expect(fromFailed.state.kind).toBe("given-up");

      // Nothing leaves except restart
      expect(transition(fromFailed.state, { kind: "start" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "started" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "stop" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "stopped" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "failed" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "giveUp" }).ok).toBe(false);
      expect(transition(fromFailed.state, { kind: "restart" }).ok).toBe(true);
    });

    it("does not import backoff — it holds a number", () => {
      // The state holds a plain number; the caller decides what to do with it.
      // This test documents that the number is the same one backoff would see.
      const f = failed(2);
      if (f.kind === "failed") {
        expect(typeof f.attempts).toBe("number");
      } else {
        expect.fail("expected failed state");
      }
      // No import of backoff is needed to read it.
    });
  });
});
