import { NodeSSH } from "node-ssh";
import * as fs from "fs";
import * as path from "path";
import { TOOL_TIMEOUTS } from "../../tool-contract.js";

export interface SSHExecArgs {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  command: string;
  timeout?: number;
}

export async function executeSshCommand(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const host = args.host as string;
  const port = (args.port as number) || 22;
  const username = args.username as string;
  const password = args.password as string | undefined;
  const privateKeyPath = args.privateKeyPath as string | undefined;
  const privateKeyPassphrase = args.privateKeyPassphrase as string | undefined;
  const command = args.command as string;
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.NETWORK;

  if (!host || !username || !command) {
    return { error: "Missing required arguments: host, username, command" };
  }

  if (!password && !privateKeyPath) {
    return { error: "Either password or privateKeyPath must be provided" };
  }

  const ssh = new NodeSSH();

  try {
    const connectConfig: any = {
      host,
      port,
      username,
      readyTimeout: timeout,
    };

    if (password) {
      connectConfig.password = password;
    } else if (privateKeyPath) {
      try {
        const keyPath = path.resolve(privateKeyPath);
        if (!fs.existsSync(keyPath)) {
          return { error: `Private key file not found: ${keyPath}` };
        }
        connectConfig.privateKey = fs.readFileSync(keyPath, "utf-8");
        if (privateKeyPassphrase) {
          connectConfig.passphrase = privateKeyPassphrase;
        }
      } catch (err: any) {
        return { error: `Failed to read private key: ${err.message}` };
      }
    }

    await ssh.connect(connectConfig);

    // Race the command against a separate execution timeout.
    // The connection timeout above only covers the handshake — once connected,
    // execCommand has no ceiling and will hang on a runaway remote command.
    const execTimeout = timeout; // reuse the same timeout param for execution
    const commandPromise = ssh.execCommand(command, { cwd: "/tmp" });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `SSH command timed out after ${execTimeout}ms. ` +
          `The remote command is still running. Retry with a higher timeout, ` +
          `or run a background command (command &) for fire-and-forget tasks.`
        )),
        execTimeout
      )
    );

    const result = await Promise.race([commandPromise, timeoutPromise]);
    await ssh.dispose();

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.code ?? 0,
    };
  } catch (err: any) {
    await ssh.dispose();
    return { error: `SSH execution failed: ${err.message}` };
  }
}
