import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolContext, ToolResult } from "../base/types";

/**
 * Returns the user's location and timezone derived from Cloudflare request metadata.
 * No external call — data is already available in the ToolContext from request.cf.
 */
export class UserLocationTool extends BaseTool {
  readonly name = "get_location";
  readonly description =
    "Get the user's precise location using the browser's native geolocation API. Triggers a permission prompt — the user must grant access. Returns latitude, longitude, accuracy (metres), and reverse-geocoded city, country, and address when available. If permission is denied, the approximate location from the session context (city/country) remains available.";
  readonly executionTarget = "client" as const;
  readonly group = "environment" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = false;

  readonly parameters = Type.Object({});

  async execute(_args: Record<string, never>, _context?: ToolContext): Promise<ToolResult> {
    // Execution is handled client-side via navigator.geolocation.
    // This method is never called in normal flow.
    return this.errorResult("get_location must execute in the browser client — not available server-side.");
  }
}

export const userLocationTool = new UserLocationTool();
