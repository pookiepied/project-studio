
import { describe, it, expect } from "vitest";
import { classifyDocument, preprocessDocumentForModel } from "../src/providers/shared/document.ts";

describe("classifyDocument", () => {
  it("classifies image", async () => {
    expect(await classifyDocument(new Uint8Array([1,2,3]), "image/png")).toBe("image");
  });
  it("classifies pdf", async () => {
    const bytes = new TextEncoder().encode("%PDF /Type /Page ".repeat(500));
    const kind = await classifyDocument(bytes, "application/pdf");
    expect(["digital_pdf","scanned_pdf"]).toContain(kind);
  });
});

describe("preprocessDocumentForModel", () => {
  it("returns vision_direct when supportsVision", async () => {
    const bytes = new Uint8Array([1,2,3]);
    const out = await preprocessDocumentForModel({ mimeType: "image/png", bytes }, { supportsVision: true, supportsPdf: false });
    expect(out.via).toBe("vision_direct");
  });
  it("returns fallback needed when no vision", async () => {
    const bytes = new Uint8Array([1,2,3]);
    const out = await preprocessDocumentForModel({ mimeType: "image/png", bytes }, { supportsVision: false, supportsPdf: false });
    expect(out.via).toBe("vision_fallback_needed");
  });
});
