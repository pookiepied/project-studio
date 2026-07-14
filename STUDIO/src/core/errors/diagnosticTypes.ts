export interface DiagnosticTest {
  id: string;
  name: string;
  category: "platform" | "storage" | "network" | "api" | "security" | "ui" | "system" | "features";
  status: "pending" | "running" | "pass" | "fail" | "warning" | "skip";
  message: string;
  details?: any;
  duration?: number;
  timestamp?: number;
}

export interface DiagnosticReport {
  timestamp: number;
  environment: string;
  platform: string;
  userAgent: string;
  tests: DiagnosticTest[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  recommendations: string[];
}
