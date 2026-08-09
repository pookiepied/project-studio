import { z } from "zod";

export const FetchInputSchema = z.object({
  url: z.string().url().describe("URL to fetch"),
  max_chars: z.number().int().min(100).max(100000).optional().default(20000).describe("Max characters to return (100-100000)"),
  offset: z.number().int().min(0).optional().default(0).describe("Character offset for pagination"),
  format: z.enum(["markdown", "text", "html"]).optional().describe("Output format hint"),
});

export type FetchInput = z.infer<typeof FetchInputSchema>;
