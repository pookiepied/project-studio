export interface WhitelistedUser {
  email: string;
  name: string | null;
  picture: string | null;
  role: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  isCurrentAdmin?: boolean;
}

export interface AdminMode {
  id: string;
  label: string;
  description: string;
  modelId: string;
  icon: "leaf" | "lightning" | "star" | "sparkle";
  defaultModelId: string;
  isCustomized: boolean;
  autoRouterMode?: "static" | "dynamic";
  autoStaticModel?: string;
  autoDefaultStaticModel?: string;
}

export type SubView = null | "whitelist" | "aimodels" | "modelRegistry";
export type FetchState = "idle" | "loading" | "ready" | "error";
export type ActionState = "idle" | "loading" | "success" | "error";
