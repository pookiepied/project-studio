export type RightWorkspaceView =
  | "terminal"
  | "browser"
  | "artifacts"
  | "files"
  | "side-chat";

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
