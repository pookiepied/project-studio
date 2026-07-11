export type RightWorkspaceView =
  | "terminal"
  | "browser"
  | "artifacts"
  | "files"
  | "side-chat";

export type WorkspaceTabType = RightWorkspaceView;

export interface BrowserWorkspaceState {
  browserTabId: string;
}

export interface TerminalWorkspaceState {
  cwd?: string | null;
}

export interface FilesWorkspaceState {
  rootPath?: string | null;
  selectedPath?: string | null;
  expandedPaths: string[];
}

export interface SideChatWorkspaceState {
  conversationId?: string | null;
}

export interface ArtifactWorkspaceState {
  artifactTabId?: string | null;
}

export type WorkspaceTabState =
  | BrowserWorkspaceState
  | TerminalWorkspaceState
  | FilesWorkspaceState
  | SideChatWorkspaceState
  | ArtifactWorkspaceState;

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  state: WorkspaceTabState;
}

export interface WorkspaceTabCreateOptions {
  title?: string;
  browserTabId?: string;
  conversationId?: string | null;
  rootPath?: string | null;
  selectedPath?: string | null;
  cwd?: string | null;
  artifactTabId?: string | null;
}

export interface ProjectContextLike {
  path: string;
}

export interface ExternalProjectApp {
  id: string;
  label: string;
  priority: number;
  category: "editor" | "ide" | "source-control" | "terminal" | "system";
  commands: string[];
  windowsPaths: string[];
  args: (projectPath: string) => string[];
  color: string;
  icon:
    | {
        kind: "simple-icon";
        path: string;
        hex: string;
        scale?: number;
      }
    | {
        kind: "custom";
        name: "vscode" | "visual-studio" | "file-explorer" | "terminal";
      };
}
