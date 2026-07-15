# Studio Tool Pool

Studio Tool Pool owns callable capability discovery and schema materialization for the cloud runtime.

It is separate from the Context Engine. The Context Engine asks Tool Pool for a compact default projection while assembling initial context. Execution, planner, and agent runtimes may call Tool Pool directly when the model requests additional tools through discovery.

Responsibilities:

- normalize native tools, MCP tools, connector actions, skill tools, agent delegation tools, and runtime actions
- apply user/system scope and runtime eligibility filters
- return compact capability summaries
- materialize full tool schemas lazily
- keep the Tool Execution Worker independent and on-demand

Tool Pool does not execute tools. Tool execution remains owned by `studio-tool-execution`.

