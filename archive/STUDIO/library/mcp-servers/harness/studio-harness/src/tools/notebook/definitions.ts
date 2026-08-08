export const NOTEBOOK_DEFINITIONS = [{
  name: "read_notebook",
  description: "Read a Jupyter notebook structurally by cell, without exposing raw ipynb JSON or large binary outputs.",
  inputSchema: { type: "object", properties: {
    path: { type: "string", description: "Path to the .ipynb notebook." }, start_cell: { type: "number", description: "0-based first cell (default 0)" },
    cell_limit: { type: "number", description: "Maximum cells (default 50, max 200)" },
    include_outputs: { type: "boolean", description: "Include bounded text output summaries (default false)" },
    max_output_chars: { type: "number", description: "Aggregate output-text budget (default 20000)" },
  }, required: ["path"] },
}] as const;
