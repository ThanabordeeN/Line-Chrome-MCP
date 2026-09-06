import type { Page } from 'playwright-core';
import { GatewayError } from '../core/errors.js';
import type { Message, MessagePage, MessageType, SendMessageInput } from '../core/types.js';
import type { GetMessagesOptions, SendMessageResult } from './adapter.js';
import { openChatFromDom } from './dom-chats.js';

export async function getMessagesFromDom(
  page: Page,
  chatId: string,
  options: GetMessagesOptions,
  maxHistoryScrolls: number
): Promise<MessagePage> {
  await openChatFromDom(page, chatId);
  const limit = Math.min(options.limit ?? 50, 500);
  const seen = new Map<string, Message>();
  const originalScrollTop = await page.evaluate(() => {
    const log = document.querySelector<HTMLElement>('[role="log"]');
    let el = log?.parentElement ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 8) return el.scrollTop;
      el = el.parentElement;
    }
    return 0;
  });
  await page.evaluate(() => {
    const log = document.querySelector<HTMLElement>('[role="log"]');
    let scroller = log?.parentElement ?? null;
    while (scroller) {
      if (scroller.scrollHeight > scroller.clientHeight + 8) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      scroller = scroller.parentElement;
    }
  });
  await page.waitForTimeout(30);

  let foundBefore = !options.before;
  try {
    for (let i = 0; i < maxHistoryScrolls; i += 1) {
      const batch = await page.evaluate((roomId) => {
        const inferType = (node: HTMLElement): MessageType => {
          const declared = (node.dataset.messageContent ?? '').toLowerCase();
          if (declared.includes('photo')) return 'image';
          if (declared.includes('sticker')) return 'sticker';
          if (declared.includes('video')) return 'video';
          if (declared.includes('file')) return 'file';
          if (node.querySelector('[data-is-message-text="true"]')) return 'text';
          if (node.querySelector('[class*="imageMessageContent"]')) return 'image';
          if (node.querySelector('[class*="stickerMessageContent"]')) return 'sticker';
          return 'unknown';
        };

        const messages = [...document.querySelectorAll<HTMLElement>('[data-message-select-id][data-timestamp]')]
          .map((node) => {
            const messageNode = node.querySelector<HTMLElement>('[data-message-id]');
            const id = messageNode?.dataset.messageId;
            const timestamp = Number(node.dataset.timestamp);
            if (!id || !Number.isFinite(timestamp)) return null;
            const prefix = node.dataset.messageContentPrefix?.trim();
            const senderName = prefix?.replace(/^\S+\s+/, '').trim();
            const senderId = node.dataset.mid;
            const text = node.querySelector<HTMLElement>('[data-is-message-text="true"]')?.textContent ?? undefined;
            const hasImage = Boolean(node.querySelector('[class*="imageMessageContent"] img'));
            const readText = node.querySelector<HTMLElement>('[class*="read_count"]')?.textContent?.trim();
            return {
              id,
              chatId: roomId,
              sender: {
                ...(senderId ? { id: senderId } : {}),
                ...(senderName ? { name: senderName } : {})
              },
              direction: node.dataset.direction === 'reverse' ? ('outgoing' as const) : ('incoming' as const),
              type: inferType(node),
              ...(text !== undefined ? { text } : {}),
              attachments: hasImage ? [{ type: 'image' as const }] : [],
              ...(readText !== undefined ? { read: readText.toLowerCase() === 'read' } : {}),
              ...(node.dataset.isE2eeMessage !== undefined ? { e2ee: node.dataset.isE2eeMessage === 'true' } : {}),
              createdAt: new Date(timestamp).toISOString(),
              platformTimestampMs: timestamp
            };
          })
          .filter(Boolean);

        const log = document.querySelector<HTMLElement>('[role="log"]');
        let scroller = log?.parentElement ?? null;
        while (scroller) {
          if (scroller.scrollHeight > scroller.clientHeight + 8) break;
          scroller = scroller.parentElement;
        }
        if (!scroller) return { messages, atTop: true };
        const before = scroller.scrollTop;
        scroller.scrollTop = Math.max(0, before - Math.max(200, Math.floor(scroller.clientHeight * 0.8)));
        return { messages, atTop: scroller.scrollTop <= 1 || scroller.scrollTop === before };
      }, chatId);

      for (const message of batch.messages as Message[]) {
        seen.set(message.id, message);
        if (message.id === options.before) foundBefore = true;
      }
      if ((foundBefore && seen.size >= limit + (options.before ? 1 : 0)) || batch.atTop) break;
      await page.waitForTimeout(30);
    }
  } finally {
    await page.evaluate((scrollTop) => {
      const log = document.querySelector<HTMLElement>('[role="log"]');
      let el = log?.parentElement ?? null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 8) {
          el.scrollTop = scrollTop;
          return;
        }
        el = el.parentElement;
      }
    }, originalScrollTop);
  }

  let ordered = [...seen.values()].sort((a, b) => a.platformTimestampMs - b.platformTimestampMs);
  if (options.before) {
    const index = ordered.findIndex((message) => message.id === options.before);
    if (index >= 0) ordered = ordered.slice(0, index);
  }
  const data = ordered.slice(-limit);
  const nextCursor = data.length === limit ? data[0]?.id : undefined;
  return { data, ...(nextCursor ? { nextCursor } : {}) };
}

export async function sendTextFromDom(page: Page, input: SendMessageInput): Promise<SendMessageResult> {
  if (input.replyTo) throw new GatewayError('CAPABILITY_NOT_SUPPORTED', 'Reply sending is not implemented yet.', 422);
  if (!input.text.trim()) throw new GatewayError('INVALID_MESSAGE', 'Message text cannot be empty.', 422);

  await openChatFromDom(page, input.chatId);
  const existingIds = new Set(
    await page.locator('[data-message-id]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.messageId).filter((id): id is string => Boolean(id))
    )
  );

  const editor = page.locator('textarea-ex[placeholder="Enter a message"]').first();
  if ((await editor.count()) === 0) {
    throw new GatewayError('EDITOR_NOT_FOUND', 'LINE message editor was not found in the current DOM.', 502);
  }

  await editor.click();
  await page.keyboard.insertText(input.text);
  await page.keyboard.press('Enter');

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const messageId = await page.evaluate(
      ({ text, existing }) => {
        const known = new Set(existing);
        const nodes = [...document.querySelectorAll<HTMLElement>('[data-message-select-id][data-direction="reverse"]')];
        for (const node of nodes.reverse()) {
          const id = node.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId;
          const value = node.querySelector<HTMLElement>('[data-is-message-text="true"]')?.textContent;
          if (id && !known.has(id) && value === text) return id;
        }
        return null;
      },
      { text: input.text, existing: [...existingIds] }
    );
    if (messageId) return { messageId, verified: true };
    await page.waitForTimeout(150);
  }

  throw new GatewayError(
    'SEND_NOT_CONFIRMED',
    'The Enter action was sent to LINE, but no matching outgoing message appeared within 8 seconds.',
    502
  );
}
