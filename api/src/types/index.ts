export * from './health';

export interface Env {
  AI: Fetcher;
  GATEWAY: Fetcher;
  CHATS_SERVICE: Fetcher;
  STUDIO: Fetcher;
  CONNECTORS: Fetcher;
  SKILLS: Fetcher;
  TRACKER?: Fetcher;
  DB: D1Database;
  KV: KVNamespace;
  RELEASES_KV: KVNamespace;
  RELEASES_BUCKET: R2Bucket;
  REVOKED_KV?: KVNamespace;
  JWT_SECRET?: string;
  SKILLS_AUTH_SECRET?: string;
  ENVIRONMENT?: string;
}

export interface Job {
  id: string;
  task_id: string;
  user_id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  execution_target: 'cloud' | 'local' | 'any';
  inputs: Record<string, unknown>;
  options: Record<string, unknown>;
  result?: unknown;
  progress?: unknown;
  error?: string;
  created_at: number;
  updated_at: number;
  completed_at?: number;
  heartbeat_at?: number;
}

export interface CreateJobRequest {
  taskId: string;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface CreateJobResponse {
  jobId: string;
  status: string;
  taskId: string;
  createdAt: string;
  estimatedWait?: string;
}

export interface TaskInput {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'text';
  required: boolean;
  default?: unknown;
  options?: string[];
  placeholder?: string;
}

export interface Task {
  taskId: string;
  name: string;
  description: string;
  workspace?: string;
  icon?: string;
  estimatedDuration?: string;
  inputs: TaskInput[];
  outputSchema?: Record<string, string>;
  tags?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  local_engine_connected?: boolean;
}

export interface Caller {
  type: 'user';
  sub?: string;
  email?: string;
  role?: string;
}
