export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  checks?: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  responseTime?: number;
  details?: Record<string, any>;
}

export interface SystemStatusResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    api: ComponentStatus;
    engine: ComponentStatus;
    ai: ComponentStatus;
    database: ComponentStatus;
  };
  metrics: {
    jobs: JobMetrics;
  };
}

export interface ComponentStatus {
  status: 'operational' | 'degraded' | 'down';
  message?: string;
  lastCheck?: string;
  metadata?: Record<string, any>;
}

export interface JobMetrics {
  queued: number;
  running: number;
  completed: number;
  failed?: number;
}
