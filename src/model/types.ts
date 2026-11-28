export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'message_done'; message: Message; stopReason: StopReason; usage?: Usage };

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface ModelClient {
  stream(req: ModelRequest): AsyncIterable<ModelEvent>;
}
