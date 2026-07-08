import { NodeSSH } from "node-ssh";
import * as fs from "fs";
import * as path from "path";
import { TOOL_TIMEOUTS } from "../../tool-contract.js";

interface SessionState {
  ssh: NodeSSH;
  connected: boolean;
  lastActivity: number;
  commandOutput: string;
}

const sessions: Map<string, SessionState> = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface SSHSessionArgs {
  sessionId: string;
  action: "open" | "send" | "close";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  command?: string;
  timeout?: number;
}

async function openSession(
  sessionId: string,
  host: string,
  port: number,
  username: string,
  password: string | undefined,
  privateKeyPath: string | undefined,
  privateKeyPassphrase: string | undefined,
  timeout: number
): Promise<Record<string, unknown>> {
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

    const session: SessionState = {
      ssh,
      connected: true,
      lastActivity: Date.now(),
      commandOutput: "",
    };

    sessions.set(sessionId, session);

    const cleanupTimer = setInterval(() => {
      const session = sessions.get(sessionId);
      if (session && Date.now() - session.lastActivity > SESSION_TIMEOUT) {
        session.ssh.dispose();
        sessions.delete(sessionId);
        clearInterval(cleanupTimer);
      }
    }, 30_000);

    return {
      success: true,
      sessionId,
      message: "SSH session opened",
    };
  } catch (err: any) {
    await ssh.dispose();
    return { error: `Failed to open session: ${err.message}` };
  }
}

const SEND_COMMAND_TIMEOUT_MS = TOOL_TIMEOUTS.NETWORK;

async function sendCommand(
  sessionId: string,
  command: string
): Promise<Record<string, unknown>> {
  const session = sessions.get(sessionId);

  if (!session || !session.connected) {
    return { error: `Session ${sessionId} not found or not connected. Open a new session first.` };
  }

  try {
    session.lastActivity = Date.now();

    // Race execution against a timeout — execCommand has no built-in ceiling.
    const commandPromise = session.ssh.execCommand(command, { cwd: "/tmp" });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `SSH command timed out after ${SEND_COMMAND_TIMEOUT_MS / 1000}s. ` +
          `The remote command is still running. For long-running operations, ` +
          `run the command in the background on the remote host (command &).`
        )),
        SEND_COMMAND_TIMEOUT_MS
      )
    );

    const result = await Promise.race([commandPromise, timeoutPromise]);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.code ?? 0,
    };
  } catch (err: any) {
    return { error: `Command execution failed: ${err.message}` };
  }
}

async function closeSession(sessionId: string): Promise<Record<string, unknown>> {
  const session = sessions.get(sessionId);

  if (!session) {
    return { error: `Session ${sessionId} not found` };
  }

  try {
    await session.ssh.dispose();
    sessions.delete(sessionId);
    return { success: true, message: `Session ${sessionId} closed` };
  } catch (err: any) {
    return { error: `Failed to close session: ${err.message}` };
  }
}

export async function manageSshSession(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const sessionId = args.sessionId as string;
  const action = args.action as string;

  if (!sessionId || !action) {
    return { error: "Missing required arguments: sessionId, action" };
  }

  if (action === "open") {
    const host = args.host as string;
    const port = (args.port as number) || 22;
    const username = args.username as string;
    const password = args.password as string | undefined;
    const privateKeyPath = args.privateKeyPath as string | undefined;
    const privateKeyPassphrase = args.privateKeyPassphrase as string | undefined;
    const timeout = (args.timeout as number) || 30_000;

    if (!host || !username) {
      return { error: "Missing required arguments: host, username" };
    }

    if (!password && !privateKeyPath) {
      return { error: "Either password or privateKeyPath must be provided" };
    }

    return openSession(
      sessionId,
      host,
      port,
      username,
      password,
      privateKeyPath,
      privateKeyPassphrase,
      timeout
    );
  }

  if (action === "send") {
    const command = args.command as string;
    if (!command) {
      return { error: "Missing required argument: command" };
    }
    return sendCommand(sessionId, command);
  }

  if (action === "close") {
    return closeSession(sessionId);
  }

  return { error: `Unknown action: ${action}` };
}
