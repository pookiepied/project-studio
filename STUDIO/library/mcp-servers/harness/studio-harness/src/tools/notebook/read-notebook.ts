import { promises as fs } from "fs";

export async function readNotebook(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.path as string;
  if (!path) return { error: "path is required" };
  const stat = await fs.stat(path);
  if (stat.size > 20 * 1024 * 1024) return { error: "Notebook exceeds 20 MB; reduce embedded outputs before reading" };
  const notebook = JSON.parse(await fs.readFile(path, "utf8"));
  if (!Array.isArray(notebook.cells)) return { error: "Invalid notebook: cells array is missing" };
  const start = Math.max(0, (args.start_cell as number) || 0);
  const limit = Math.min((args.cell_limit as number) || 50, 200);
  const includeOutputs = (args.include_outputs as boolean) || false;
  let outputBudget = Math.min((args.max_output_chars as number) || 20_000, 200_000);
  const cells = notebook.cells.slice(start, start + limit).map((cell: any, offset: number) => {
    const result: Record<string, unknown> = { index: start + offset, id: cell.id, type: cell.cell_type, source: Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || ""), execution_count: cell.execution_count ?? undefined, metadata: cell.metadata || {} };
    if (includeOutputs && Array.isArray(cell.outputs)) result.outputs = cell.outputs.map((output: any) => {
      const text = Array.isArray(output.text) ? output.text.join("") : output.data?.["text/plain"] ? (Array.isArray(output.data["text/plain"]) ? output.data["text/plain"].join("") : output.data["text/plain"]) : output.ename ? `${output.ename}: ${output.evalue}` : "";
      const bounded = String(text).slice(0, outputBudget); outputBudget -= bounded.length;
      return { type: output.output_type, text: bounded || undefined, truncated: String(text).length > bounded.length, rich_types: output.data ? Object.keys(output.data).filter((x: string) => x !== "text/plain") : undefined };
    });
    return result;
  });
  return { path, format: notebook.nbformat, format_minor: notebook.nbformat_minor, language: notebook.metadata?.language_info?.name, kernel: notebook.metadata?.kernelspec, total_cells: notebook.cells.length, start_cell: start, cells, truncated: start + cells.length < notebook.cells.length };
}
