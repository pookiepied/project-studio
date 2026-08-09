import { z } from "zod";

export const SearchInputSchema = z.object({
  query: z.string().min(1).max(500).describe("Search query"),
  max_results: z.number().int().min(1).max(20).optional().default(5).describe("Max results (1-20)"),
  topic: z.enum(["general", "news", "finance"]).optional().describe("Search topic"),
  time_range: z.string().optional().describe("Time range e.g. day, week, month, year"),
  domains: z.array(z.string()).optional().describe("Include domains"),
  exclude_domains: z.array(z.string()).optional().describe("Exclude domains"),
  search_depth: z.enum(["basic", "advanced"]).optional().describe("Search depth"),
  country: z.string().optional().describe("Country boost"),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
