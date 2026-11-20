import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function chromeUserDataDirectory(): string {
  if (process.platform === "win32") {
    return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "Google", "Chrome", "User Data");
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  return join(process.env["CHROME_CONFIG_HOME"] ?? process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "google-chrome");
}

export function chromeEndpoint(contents: string): string | undefined {
  const [port, path, ...rest] = contents.trim().split(/\r?\n/);
  if (port === undefined || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return undefined;
  if (path === undefined || !/^\/devtools\/browser\/[\da-f-]{36}$/i.test(path) || rest.length > 0) return undefined;
  return `ws://127.0.0.1:${Number(port)}${path}`;
}

export async function readChromeEndpoint(directory = chromeUserDataDirectory()): Promise<string | undefined> {
  const file = await open(join(directory, "DevToolsActivePort"), "r");
  try {
    if (!(await file.stat()).isFile()) return undefined;
    const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(256) });
    return bytesRead < buffer.length ? chromeEndpoint(buffer.toString("utf8", 0, bytesRead)) : undefined;
  } finally {
    await file.close();
  }
}
