export interface ComposioConnection {
  id: string;
  appName: string;
  status: "ACTIVE" | "INITIATED" | "EXPIRED" | "FAILED";
  entityId: string;
}

export interface ComposioAction {
  slug:            string;
  name:            string;
  description:     string;
  appName:         string;
  inputParameters: Record<string, any>;
}

export interface ComposioUserConfig {
  userId: string;
  apiKey: string;
  entityId: string;
}

export interface ComposioAppSummary {
  appName:     string;
  displayName: string;
  tools:       { name: string; description: string }[];
}
