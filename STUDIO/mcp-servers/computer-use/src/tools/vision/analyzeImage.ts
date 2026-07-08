/**
 * analyze_image — load an image from a local file path and return it as
 * MCP image content so the LLM can directly see and analyze it.
 *
 * This is the missing bridge between screenshot tools and vision analysis:
 *   capture_screenshot → { path: "C:\\...\\screenshot.png" }
 *   analyze_image(path) → [{ type:"image", data:"...", mimeType:"image/png" }, ...]
 *
 * The LLM can then perceive the actual visual content.
 *
 * Use cases:
 *   - Analyze a screenshot captured by capture_screenshot
 *   - Analyze any image file on the local filesystem
 *   - Verify the result of an annotated_snapshot
 *   - Inspect generated charts, diagrams, or exported images
 */

import { loadImageFromFile } from "./imageLoader.js";
import type { McpContent } from "./types.js";

export async function analyzeImage(args: Record<string, unknown>): Promise<McpContent[]> {
  const filePath = (args.path as string | undefined)?.trim();

  if (!filePath) {
    return [{
      type: "text",
      text: JSON.stringify({
        error: "path is required — provide the absolute path to an image file. " +
               "Example: C:\\Users\\user\\AppData\\Local\\Temp\\studio-screenshot-20240101.png",
      }),
    }];
  }

  const result = loadImageFromFile(filePath);

  if (!result.ok || !result.content) {
    return [{
      type: "text",
      text: JSON.stringify({ error: result.error }),
    }];
  }

  return [
    result.content,
    {
      type: "text",
      text: JSON.stringify({
        success:  true,
        path:     filePath,
        bytes:    result.bytes,
        mimeType: result.content.mimeType,
        note:     "Image loaded — analyze the visual content shown above.",
      }),
    },
  ];
}
