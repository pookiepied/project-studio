export interface CodingProjectResolutionOptions {
  explicitPath?: string | null;
  conversationProjectPath?: string | null;
  workspaceProjectPath?: string | null;
  defaultPath?: string | null;
}

export interface CodingProjectResolution {
  path: string | null;
  source: "explicit" | "conversation" | "workspace" | "default" | "picker";
}

/** One resolution order for every coding-session entry point. */
export function resolveCodingProject(options: CodingProjectResolutionOptions): CodingProjectResolution {
  if (options.explicitPath) return { path: options.explicitPath, source: "explicit" };
  if (options.conversationProjectPath) return { path: options.conversationProjectPath, source: "conversation" };
  if (options.workspaceProjectPath) return { path: options.workspaceProjectPath, source: "workspace" };
  if (options.defaultPath) return { path: options.defaultPath, source: "default" };
  return { path: null, source: "picker" };
}
