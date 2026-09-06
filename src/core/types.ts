export type ChatType = 'direct' | 'group' | 'official' | 'unknown';
export type MessageDirection = 'incoming' | 'outgoing';
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location' | 'unknown';

export interface ChatSummary {
  id: string;
  type: ChatType;
  title: string;
  unreadCount: number;
  muted: boolean;
  memberCount?: number;
  lastMessage?: string;
  updatedAt?: string;
}

export interface Attachment {
  type: Exclude<MessageType, 'text'>;
  url?: string;
  name?: string;
}

export interface Message {
  id: string;
  chatId: string;
  sender: {
    id?: string;
    name?: string;
  };
  direction: MessageDirection;
  type: MessageType;
  text?: string;
  replyTo?: string;
  attachments: Attachment[];
  read?: boolean;
  e2ee?: boolean;
  createdAt: string;
  platformTimestampMs: number;
}

export interface MessagePage {
  data: Message[];
  nextCursor?: string;
}

export interface GatewayCapabilities {
  read: {
    chats: boolean;
    messages: boolean;
    imageMetadata: boolean;
    stickerMetadata: boolean;
    replies: boolean;
  };
  write: {
    text: boolean;
    reply: boolean;
    file: boolean;
    image: boolean;
    reaction: boolean;
  };
  transports: {
    rest: boolean;
    sseEvents: boolean;
    mcpStdio: boolean;
    mcpStreamableHttp: boolean;
  };
}

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Operation<T = unknown> {
  id: string;
  type: string;
  status: OperationStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: T;
  error?: { code: string; message: string };
}

export interface SendMessageInput {
  chatId: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export interface GatewayStatus {
  ready: boolean;
  connected: boolean;
  pageUrl?: string;
  activeChatId?: string;
  reason?: string;
}
