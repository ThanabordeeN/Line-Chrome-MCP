import type { ChatSummary, GatewayCapabilities, GatewayStatus, MessagePage, Operation, SendMessageInput } from '../core/types.js';

export interface McpGateway {
  status(): Promise<GatewayStatus>;
  capabilities(): GatewayCapabilities | Promise<GatewayCapabilities>;
  listChats(options?: { query?: string; unreadOnly?: boolean; limit?: number }): Promise<ChatSummary[]>;
  getMessages(chatId: string, options?: { limit?: number; before?: string }): Promise<MessagePage>;
  sendMessage(input: SendMessageInput): Promise<Operation> | Operation;
  getOperation(id: string): Promise<Operation | undefined> | Operation | undefined;
}
