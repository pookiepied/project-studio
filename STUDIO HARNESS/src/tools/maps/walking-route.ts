import * as v from "valibot";
import { NATIVE_PROVENANCE, type CapabilityDescriptor } from "../../contracts/capabilities.js";
import { MAX_WALKING_STOPS, walkingRouteHost, walkingStopSchema, type WalkingRoutes } from "../../gateway/maps/walking.js";
import { ToolError } from "../errors.js";
import { defineStudioTool } from "../types.js";

const descriptor: CapabilityDescriptor = {
  id: { namespace: "native", name: "walking_route" },
  title: "Calculate a walking route",
  description: "Calculate a walking route through two to five stops in the given order, using known coordinates. Studio displays the route, distance, and estimated walking time directly in the conversation.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["stops"],
    properties: {
      stops: {
        type: "array",
        minItems: 2,
        maxItems: MAX_WALKING_STOPS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "lat", "lng"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            lat: { type: "number", minimum: -85, maximum: 85 },
            lng: { type: "number", minimum: -180, maximum: 180 },
          },
        },
      },
    },
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

const inputSchema = v.strictObject({ stops: v.pipe(v.array(walkingStopSchema), v.minLength(2), v.maxLength(MAX_WALKING_STOPS)) });

export function createWalkingRouteTool(routes: Pick<WalkingRoutes, "route">) {
  return defineStudioTool({
    descriptor,
    resourceKind: "command",
    deadlineMs: 20_000,
    resource: walkingRouteHost,
    parse: (input) => {
      const parsed = v.safeParse(inputSchema, input);
      if (!parsed.success) {
        throw new ToolError("invalid_input", { message: "Give two to five named stops with valid numeric latitude and longitude." });
      }
      return parsed.output;
    },
    execute: async ({ stops }, { signal }) => {
      const route = await routes.route(stops, signal);
      return {
        content: [{
          type: "text",
          text: `Walking route calculated by openrouteservice. Total ${route.distanceMeters} metres, estimated ${route.durationSeconds} seconds. Studio displays the route and the legs from this tool result.`,
        }],
        // Flue stores structured output for the transcript. The model gets
        // the short content above and never has to copy the geometry.
        output: route,
      };
    },
  });
}
