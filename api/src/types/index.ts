export * from './health';

export interface Env {
  EXECUTION_RUNTIME: Fetcher;
  PLANNER_RUNTIME: Fetcher;
  DATA: Fetcher;
  REGISTRY: Fetcher;
  GATEWAY: Fetcher;
  REVOKED_KV?: KVNamespace;
  JWT_SECRET?: string;
  REGISTRY_MANAGEMENT_TOKEN?: string;
  ENVIRONMENT?: string;
}

export interface Caller {
  type: 'user';
  sub: string;
  email?: string;
  role?: string;
}
