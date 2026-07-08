import { spawn } from "child_process";
import { promises as fs } from "fs";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { DEFAULT_MAX_OUTPUT_CHARS, ABSOLUTE_MAX_OUTPUT_CHARS } from "./run_process.js";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export async function runRepl(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const language = args.language as "node" | "python";
  const code = args.code as string;
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.FAST_QUERY;
  const rawMax = args.max_output_chars as number | undefined;
  const maxChars = Math.min(
    (rawMax != null && rawMax > 0) ? rawMax : DEFAULT_MAX_OUTPUT_CHARS,
    ABSOLUTE_MAX_OUTPUT_CHARS
  );

  const ext = language === "node" ? "mjs" : "py";
  const tmpFile = join(tmpdir(), `studio-repl-${randomUUID()}.${ext}`);

  try {
    await fs.writeFile(tmpFile, code, "utf-8");

    const [cmd, cmdArgs] =
      language === "node"
        ? (["node", [tmpFile]] as [string, string[]])
        : (["python", [tmpFile]] as [string, string[]]);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(cmd, cmdArgs, {
        stdio: "pipe",
        env: { ...process.env },
      });

      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          output: stdout,
          error:
            `Execution timed out after ${timeout}ms. ` +
            `Split the code into smaller chunks, or increase the timeout parameter.`,
          exit_code: -1,
        });
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        let out = stdout;
        let outTruncated = false;
        if (out.length > maxChars) {
          out = out.slice(0, maxChars) +
            `\n\n[Output truncated — ${stdout.length.toLocaleString()} chars total, ` +
            `first ${maxChars.toLocaleString()} shown. Pass max_output_chars up to ${ABSOLUTE_MAX_OUTPUT_CHARS.toLocaleString()} to see more.]`;
          outTruncated = true;
        }
        resolve({
          output: out,
          error: stderr || undefined,
          exit_code: code ?? 0,
          ...(outTruncated && { output_truncated: true }),
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        // Resolve (not reject) so the caller always gets a structured result.
        resolve({
          output: stdout,
          error:
            err.message.includes("ENOENT")
              ? `${language === "node" ? "node" : "python"} not found in PATH. Is it installed?`
              : `Process error: ${err.message}`,
          exit_code: -1,
        });
      });
    });
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}
