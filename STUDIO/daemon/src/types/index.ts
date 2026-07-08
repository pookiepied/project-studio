export interface LocalProviderRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
  stream?: boolean;
  toolCallbackUrl?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface LocalModel {
  id: string;
  name: string;
  provider: 'ollama' | 'lmstudio';
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    [key: string]: any;
  };
}

export interface DaemonHealth {
  running: boolean;
  port: number;
  providers: {
    ollama: boolean;
    lmstudio: boolean;
  };
  models: number;
  uptime: number;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ToolCallEvent {
  type: 'tool_call';
  tool_name: string;
  tool_input: Record<string, any>;
}

export interface StreamEvent {
  type: 'start' | 'chunk' | 'finish' | 'error';
  data?: any;
  error?: string;
}
