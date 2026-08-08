import { logger } from '../config/logger';

export interface ToolCallRequest {
  toolName: string;
  toolInput: Record<string, any>;
  sessionId?: string;
}

export interface ToolCallResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class ToolCallHandler {
  async executeToolCall(request: ToolCallRequest, callbackUrl: string): Promise<ToolCallResult> {
    try {
      logger.info('ToolCallHandler', `Executing tool: ${request.toolName}`, { sessionId: request.sessionId });

      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: request.toolName,
          toolInput: request.toolInput,
          sessionId: request.sessionId,
        }),
      });

      if (!response.ok) {
        logger.error('ToolCallHandler', `Tool execution failed with status ${response.status}`);
        return {
          success: false,
          error: `Tool execution failed: ${response.statusText}`,
        };
      }

      const result = await response.json();
      logger.info('ToolCallHandler', `Tool executed successfully: ${request.toolName}`);
      return {
        success: true,
        result,
      };
    } catch (error) {
      logger.error('ToolCallHandler', 'Tool execution failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const toolCallHandler = new ToolCallHandler();
