export interface ComponentHealth {
  status: "operational" | "degraded" | "down";
  message?: string;
  lastCheck?: string;
  metadata?: { modelCount?: number; responseTime?: number };
}

export interface SystemStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  components: {
    api?: ComponentHealth;
    engine?: ComponentHealth;
    ai?: ComponentHealth;
    database?: ComponentHealth;
  };
  metrics?: {
    jobs?: { queued: number; running: number; completed: number; failed: number };
  };
}

export interface AuthHealth {
  status: string;
  service: string;
  timestamp: string;
  version: string;
}

export interface ProviderStat {
  provider: string;
  requests: number;
  cost_usd: number | null;
  success_count: number;
  error_count: number;
  success_rate: number;
}

export interface CreditEntry {
  provider: string;
  balance_usd: number | null;
  used_usd: number | null;
  purchased_usd: number | null;
  updated_at: string;
  supported?: boolean;
  error?: string;
}

export interface SummaryData {
  window_days: number;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number | null;
  success_rate: number | null;
  error_count: number;
  by_provider: ProviderStat[];
  credits: CreditEntry[];
}

export interface UsageRow {
  label: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  success_count: number;
  error_count: number;
  error_rate?: number;
}

export interface LogEntry {
  id: string;
  created_at: string;
  user_id: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  generation_id: string | null;
  request_type: string;
  status: string;
  error_type: string | null;
  source: string | null;
  tool_call_count: number | null;
  estimated_cost_usd: number | null;
}

export type ChartMetric = "requests" | "input_tokens" | "output_tokens" | "cost_usd" | "error_rate";
export type ActivityMode = "gateway" | "agents" | "system";
