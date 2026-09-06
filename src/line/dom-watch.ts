import type { Page } from 'playwright-core';
import type { MessageType } from '../core/types.js';
import type { LineAdapterEvent } from './adapter.js';

interface WatchMessage {
  id: string;
  chatId: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  type: MessageType;
  text?: string;
  senderId?: string;
  senderName?: string;
}

export function startDomWatcher(
  pageProvider: () => Promise<Page | undefined>,
  listener: (event: LineAdapterEvent) => void
): () => void {
  const maxMessageTimestamp = new Map<string, number>();
  const chatFingerprints = new Map<string, string>();
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const page = await pageProvider();
      if (!page) return;
      const snapshot = await page.evaluate(() => {
        const active = document.querySelector<HTMLElement>('div[data-is-dropzone="true"][data-mid]')?.dataset.mid;
        const messages = [...document.querySelectorAll<HTMLElement>('[data-message-select-id][data-timestamp]')]
          .map((node) => {
            const id = node.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId;
            const timestamp = Number(node.dataset.timestamp);
            if (!active || !id || !Number.isFinite(timestamp)) return null;
            const text = node.querySelector<HTMLElement>('[data-is-message-text="true"]')?.textContent ?? undefined;
            const prefix = node.dataset.messageContentPrefix?.trim();
            const declared = (node.dataset.messageContent ?? '').toLowerCase();
            const type = node.querySelector('[data-is-message-text="true"]')
              ? 'text'
              : declared.includes('photo') || node.querySelector('[class*="imageMessageContent"]')
                ? 'image'
                : declared.includes('sticker') || node.querySelector('[class*="stickerMessageContent"]')
                  ? 'sticker'
                  : 'unknown';
            return {
              id,
              chatId: active,
              timestamp,
              direction: node.dataset.direction === 'reverse' ? ('outgoing' as const) : ('incoming' as const),
              type,
              ...(text !== undefined ? { text } : {}),
              ...(node.dataset.mid ? { senderId: node.dataset.mid } : {}),
              ...(prefix ? { senderName: prefix.replace(/^\S+\s+/, '').trim() } : {})
            };
          })
          .filter(Boolean);

        const chats = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Go chatroom"]')]
          .map((button) => {
            const row = button.closest<HTMLElement>('[data-mid]');
            const id = row?.dataset.mid;
            if (!row || !id) return null;
            return {
              id,
              title: row.querySelector('strong pre, strong')?.textContent?.trim() ?? '',
              unreadCount: Number.parseInt(row.querySelector('[class*="message_count"]')?.textContent?.trim() ?? '0', 10) || 0,
              lastMessage: row.querySelector('[class*="description"]')?.textContent?.trim() ?? '',
              time: row.querySelector('time')?.getAttribute('datetime') ?? ''
            };
          })
          .filter(Boolean);
        return { messages, chats };
      });

      for (const message of snapshot.messages as WatchMessage[]) {
        const max = maxMessageTimestamp.get(message.chatId);
        if (max === undefined) {
          maxMessageTimestamp.set(message.chatId, message.timestamp);
          continue;
        }
        if (message.timestamp <= max) continue;
        maxMessageTimestamp.set(message.chatId, message.timestamp);
        listener({
          type: 'message.created',
          data: {
            id: message.id,
            chatId: message.chatId,
            direction: message.direction,
            type: message.type,
            ...(message.text !== undefined ? { text: message.text } : {}),
            sender: {
              ...(message.senderId ? { id: message.senderId } : {}),
              ...(message.senderName ? { name: message.senderName } : {})
            },
            createdAt: new Date(message.timestamp).toISOString(),
            platformTimestampMs: message.timestamp
          }
        });
      }

      for (const chat of snapshot.chats as Array<{ id: string; title: string; unreadCount: number; lastMessage: string; time: string }>) {
        const fingerprint = `${chat.unreadCount}\u0000${chat.lastMessage}\u0000${chat.time}`;
        const previous = chatFingerprints.get(chat.id);
        chatFingerprints.set(chat.id, fingerprint);
        if (previous !== undefined && previous !== fingerprint) listener({ type: 'chat.updated', data: chat });
      }
    } catch {
      // Best-effort watcher; explicit API calls surface adapter errors.
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 750);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
