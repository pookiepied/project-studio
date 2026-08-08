import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import { promises as fs } from "fs";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { DEFAULT_MAX_OUTPUT_CHARS, ABSOLUTE_MAX_OUTPUT_CHARS, killTree } from "./run_process.js";
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

    return await new Promise<Record<string, unknown>>((resolve) => {
      // Bounded head + accurate total, and a decoder that survives multibyte
      // splits — mirrors run_process so a chatty script can't exhaust memory.
      let head = "";
      let total = 0;
      let stderr = "";
      const outDec = new StringDecoder("utf8");
      const errDec = new StringDecoder("utf8");

      const appendOut = (text: string) => {
        if (!text) return;
        total += text.length;
        const room = ABSOLUTE_MAX_OUTPUT_CHARS - head.length;
        if (room > 0) head += text.length <= room ? text : text.slice(0, room);
      };

      const proc = spawn(cmd, cmdArgs, {
        stdio: "pipe",
        env: { ...process.env },
        detached: process.platform !== "win32",
      });

      proc.stdout?.on("data", (d: Buffer) => appendOut(outDec.write(d)));
      proc.stderr?.on("data", (d: Buffer) => { stderr += errDec.write(d); });

      const timer = setTimeout(() => {
        killTree(proc); // kill the whole tree — the script may have spawned children
        appendOut(outDec.end());
        resolve({
          output: head,
          error:
            `Execution timed out after ${timeout}ms. ` +
            `Split the code into smaller chunks, or increase the timeout parameter.`,
          exit_code: -1,
        });
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        appendOut(outDec.end());
        stderr += errDec.end();
        let out = head;
        let outTruncated = false;
        if (total > maxChars) {
          out = head.slice(0, maxChars) +
            `\n\n[Output truncated — ${total.toLocaleString()} chars total, ` +
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
          output: head,
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
