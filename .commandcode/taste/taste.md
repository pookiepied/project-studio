# Taste

## Workflow / communication

- For audit/review tasks, does not want any changes made to source or test code — the deliverable is a written report only (explicitly stated: "don't make any changes in the code"). Confidence: 0.9
- Prefers audit findings to be evidence-based: quote exact file paths, line numbers, and the relevant lines, and verify each claim against the code rather than trusting documentation; flag unverified items explicitly rather than passing them off as confirmed. Confidence: 0.8
- Prefers an audit workflow that (1) establishes a baseline first (typecheck, build, full test suite, capturing long-running output to files), (2) investigates claims category by category, and (3) reconciles independent findings against the project's own tracking documents only at the very end, separating already-known vs. genuinely new findings. Confidence: 0.8
- Scopes design/brand work to the STUDIO app only — explicitly told the assistant to ignore the Gateway; recommendations and changes should target STUDIO, not sibling apps. Confidence: 0.8
- Wants brand identity and design decisions recorded as a durable written contract (an ADR in the project's decisions folder), not just implemented in code — "create a brand identity" means documenting it, not only styling. Confidence: 0.6
