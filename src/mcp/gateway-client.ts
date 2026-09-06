import { GatewayError } from '../core/errors.js';
import type { ChatSummary, GatewayCapabilities, GatewayStatus, MessagePage, Operation, SendMessageInput } from '../core/types.js';
import type { McpGateway } from './types.js';

export class RestGatewayClient implements McpGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  status(): Promise<GatewayStatus> {
    return this.request('/v1/status');
  }

  capabilities(): Promise<GatewayCapabilities> {
    return this.request('/v1/capabilities');
  }

  async listChats(options: { query?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<ChatSummary[]> {
    const params = new URLSearchParams();
    if (options.query) params.set('q', options.query);
    if (options.unreadOnly !== undefined) params.set('unread', String(options.unreadOnly));
    if (options.limit) params.set('limit', String(options.limit));
    const result = await this.request<{ data: ChatSummary[] }>(`/v1/chats?${params}`);
    return result.data;
  }

  getMessages(chatId: string, options: { limit?: number; before?: string } = {}): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.before) params.set('before', options.before);
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/messages?${params}`);
  }

  sendMessage(input: SendMessageInput): Promise<Operation> {
    return this.request(`/v1/chats/${encodeURIComponent(input.chatId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.idempotencyKey ? { client_request_id: input.idempotencyKey } : {})
      })
    });
  }

  async getOperation(id: string): Promise<Operation | undefined> {
    try {
      return await this.request(`/v1/operations/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof GatewayError && error.status === 404) return undefined;
      throw error;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body) headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    const response = await fetch(new URL(path, this.baseUrl), { ...init, headers });
    if (!response.ok) {
      let payload: { code?: string; detail?: string; title?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // ignore malformed error bodies
      }
      throw new GatewayError(payload.code ?? 'GATEWAY_HTTP_ERROR', payload.detail ?? payload.title ?? response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
