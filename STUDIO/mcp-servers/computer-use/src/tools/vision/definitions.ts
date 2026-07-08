/**
 * Tool schema definitions for vision-intelligence tools — the ones that return
 * image content (pixels) or extracted text directly to the LLM.
 *
 * Handlers live in this same folder (tools/vision/). The screen-capture tools
 * that only save a PNG to disk (screenshot_region, annotated_snapshot,
 * ocr_screen) are implemented under tools/desktop/automation/, so their schemas
 * live in that folder's definitions — not here — to keep schema and handler
 * co-located.
 */
export const VISION_DEFINITIONS = [
  {
    name: "screenshot_and_analyze",
    description:
      "Capture a screenshot and immediately return it as image content for direct LLM vision analysis. " +
      "This is the primary 'see the screen' tool — use it whenever you need to observe the current visual state. " +
      "Combines capture + load in one call (no separate analyze_image step needed, no temp files left behind). " +
      "Capture modes (mutually exclusive): " +
      "(1) window_title — capture a specific named window; " +
      "(2) x + y + width + height — capture a screen region; " +
      "(3) default — capture the full primary monitor (or specify monitor index). " +
      "Returns the screenshot as image content the vision model can see, plus dimension metadata.",
    inputSchema: {
      type: "object",
      properties: {
        monitor:      { type: "number",  description: "Monitor index: 0=primary (default), -1=all monitors combined, N=Nth screen. Ignored when window_title or region is set." },
        window_title: { type: "string",  description: "Capture a specific window — substring match on title (e.g. 'Chrome', 'Notepad'). Use list_windows first if unsure of the title." },
        x:            { type: "number",  description: "Region left edge in pixels (requires y, width, height)" },
        y:            { type: "number",  description: "Region top edge in pixels" },
        width:        { type: "number",  description: "Region width in pixels" },
        height:       { type: "number",  description: "Region height in pixels" },
      },
      required: [],
    },
  },
  {
    name: "analyze_image",
    description:
      "Load a local image file and return it as image content for direct LLM vision analysis. " +
      "Use this after capture_screenshot, capture_window_screenshot, or any tool that saves an image to disk. " +
      "Also use for any existing image files: photos, charts, diagrams, exports, generated images. " +
      "Supported formats: PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF. " +
      "Returns the image as content the vision model can see, plus file metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the image file, e.g. C:\\Users\\user\\AppData\\Local\\Temp\\studio-screenshot-20240101.png" },
      },
      required: ["path"],
    },
  },
  {
    name: "ocr_file",
    description:
      "Extract all text from a local image file using Windows OCR (Windows.Media.Ocr.OcrEngine). " +
      "Works on any image file — not limited to the current screen like ocr_screen. " +
      "Use for: scanned documents, screenshots saved to disk, photos of text, UI mockups, diagrams with labels. " +
      "Returns the full extracted text as a string plus per-line breakdown and detected language tag. " +
      "Requires: Windows 10/11 with at least one language pack installed.",
    inputSchema: {
      type: "object",
      properties: {
        path:     { type: "string", description: "Absolute path to the image file" },
        language: { type: "string", description: "BCP-47 language tag e.g. 'en-US', 'de-DE' (defaults to user profile language)" },
      },
      required: ["path"],
    },
  },
  {
    name: "ocr_url",
    description:
      "Fetch an image from a URL and extract all text using Windows OCR. " +
      "Combines HTTP fetch + file OCR into one call for URL-based image sources. " +
      "Use when you have a URL to an image containing text and need to read that text. " +
      "Returns the same structure as ocr_file: full text string + per-line breakdown + detected language.",
    inputSchema: {
      type: "object",
      properties: {
        url:      { type: "string", description: "Image URL — must start with http:// or https://" },
        language: { type: "string", description: "BCP-47 language tag e.g. 'en-US' (defaults to user profile language)" },
      },
      required: ["url"],
    },
  },
] as const;
