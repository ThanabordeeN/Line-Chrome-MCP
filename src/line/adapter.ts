import type { ChatSummary, GatewayCapabilities, GatewayStatus, MessagePage, SendMessageInput } from '../core/types.js';

export interface ListChatsOptions {
  query?: string;
  unreadOnly?: boolean;
  limit?: number;
}

export interface GetMessagesOptions {
  limit?: number;
  before?: string;
}

export interface SendMessageResult {
  messageId?: string;
  verified: boolean;
}

export interface LineAdapterEvent {
  type: string;
  data: unknown;
}

export interface LineAdapter {
  status(): Promise<GatewayStatus>;
  capabilities(): GatewayCapabilities;
  listChats(options?: ListChatsOptions): Promise<ChatSummary[]>;
  getMessages(chatId: string, options?: GetMessagesOptions): Promise<MessagePage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  startWatching?(listener: (event: LineAdapterEvent) => void): Promise<() => void>;
  close(): Promise<void>;
}
