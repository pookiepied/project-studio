/** Tool schema definitions for SSH/network remote execution tools. */
export const NETWORK_DEFINITIONS = [
  {
    name: "ssh_exec",
    description:
      "Execute a command on a remote SSH server. Supports password and private key authentication. " +
      "Use this to run commands on VPS or remote machines. Returns stdout, stderr, and exit code.",
    inputSchema: {
      type: "object",
      properties: {
        host:                { type: "string", description: "SSH server hostname or IP address" },
        port:                { type: "number", description: "SSH port (default 22)" },
        username:            { type: "string", description: "SSH username" },
        password:            { type: "string", description: "Password for password-based auth (optional)" },
        privateKeyPath:      { type: "string", description: "Path to private key file (e.g. ~/.ssh/id_rsa)" },
        privateKeyPassphrase:{ type: "string", description: "Passphrase for encrypted private key (optional)" },
        command:             { type: "string", description: "Command to execute on the remote server" },
        timeout:             { type: "number", description: "Timeout in milliseconds (default 30000)" },
      },
      required: ["host", "username", "command"],
    },
  },
  {
    name: "ssh_session",
    description:
      "Open, manage, and interact with persistent SSH shell sessions. " +
      "Supports opening a session, sending commands, and closing connections. " +
      "Sessions persist across multiple commands until explicitly closed.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId:           { type: "string", description: "Unique identifier for this SSH session" },
        action: {
          type: "string",
          enum: ["open", "send", "close"],
          description: "Action to perform: 'open' (create session), 'send' (send command), 'close' (disconnect)",
        },
        host:                { type: "string", description: "SSH server hostname or IP (required for 'open')" },
        port:                { type: "number", description: "SSH port (default 22, required for 'open')" },
        username:            { type: "string", description: "SSH username (required for 'open')" },
        password:            { type: "string", description: "Password for password-based auth (optional)" },
        privateKeyPath:      { type: "string", description: "Path to private key file (optional)" },
        privateKeyPassphrase:{ type: "string", description: "Passphrase for encrypted private key (optional)" },
        command:             { type: "string", description: "Command to send (required for 'send' action)" },
        timeout:             { type: "number", description: "Connection timeout in milliseconds (default 30000)" },
      },
      required: ["sessionId", "action"],
    },
  },
] as const;
