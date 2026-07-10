import { invoke } from "@tauri-apps/api/core";

export interface GitBranch {
  name: string;
  current: boolean;
  worktreePath: string | null;
}

export interface GitCheckoutResult {
  branch: string;
  path: string;
}

export const gitService = {
  listBranches: (path: string) => invoke<GitBranch[]>("git_list_branches", { path }),
  checkoutBranch: (path: string, branch: string) =>
    invoke<GitCheckoutResult>("git_checkout_branch", { path, branch }),
  createBranch: (path: string, branch: string) =>
    invoke<GitCheckoutResult>("git_create_branch", { path, branch }),
};
