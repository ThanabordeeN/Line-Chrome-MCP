import type { Page } from 'playwright-core';
import { GatewayError } from '../core/errors.js';
import type { ChatSummary } from '../core/types.js';
import type { ListChatsOptions } from './adapter.js';

function clampLimit(limit: number | undefined): number {
  return Math.min(limit ?? 50, 200);
}

export async function listChatsFromDom(page: Page, options: ListChatsOptions = {}): Promise<ChatSummary[]> {
  const originalScrollTop = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Go chatroom"]');
    let el = button?.parentElement ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 8) return el.scrollTop;
      el = el.parentElement;
    }
    return 0;
  });

  const seen = new Map<string, ChatSummary>();
  try {
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Go chatroom"]');
      let el = button?.parentElement ?? null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 8) {
          el.scrollTop = 0;
          return;
        }
        el = el.parentElement;
      }
    });

    for (let i = 0; i < 100; i += 1) {
      const batch = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Go chatroom"]')];
        const chats = buttons
          .map((button) => {
            const row = button.closest<HTMLElement>('[data-mid]');
            const id = row?.dataset.mid;
            if (!row || !id) return null;
            const title = row.querySelector('strong pre, strong')?.textContent?.trim() ?? '';
            const memberText = row.querySelector('[class*="member_count"]')?.textContent ?? '';
            const memberMatch = memberText.match(/\((\d+)\)/);
            const unreadText = row.querySelector('[class*="message_count"]')?.textContent?.trim() ?? '0';
            const description = row.querySelector('[class*="description"]')?.textContent?.trim() ?? undefined;
            const time = row.querySelector('time')?.getAttribute('datetime') ?? undefined;
            return {
              id,
              type: memberMatch ? ('group' as const) : ('unknown' as const),
              title,
              unreadCount: Number.parseInt(unreadText, 10) || 0,
              muted: Boolean(row.querySelector('[class*="icon_mute"]')),
              ...(memberMatch ? { memberCount: Number.parseInt(memberMatch[1]!, 10) } : {}),
              ...(description ? { lastMessage: description } : {}),
              ...(time ? { updatedAt: new Date(time).toISOString() } : {})
            };
          })
          .filter(Boolean);

        let scroller = buttons[0]?.parentElement ?? null;
        while (scroller) {
          if (scroller.scrollHeight > scroller.clientHeight + 8) break;
          scroller = scroller.parentElement;
        }
        if (!scroller) return { chats, done: true };
        const before = scroller.scrollTop;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(max, before + Math.max(160, Math.floor(scroller.clientHeight * 0.8)));
        return { chats, done: scroller.scrollTop >= max - 2 || scroller.scrollTop === before };
      });

      for (const chat of batch.chats as ChatSummary[]) seen.set(chat.id, chat);
      if (batch.done) break;
      await page.waitForTimeout(20);
    }
  } finally {
    await page.evaluate((scrollTop) => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Go chatroom"]');
      let el = button?.parentElement ?? null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 8) {
          el.scrollTop = scrollTop;
          return;
        }
        el = el.parentElement;
      }
    }, originalScrollTop);
  }

  let result = [...seen.values()];
  if (options.query) {
    const query = options.query.toLocaleLowerCase();
    result = result.filter((chat) => chat.title.toLocaleLowerCase().includes(query));
  }
  if (options.unreadOnly) result = result.filter((chat) => chat.unreadCount > 0);
  return result.slice(0, clampLimit(options.limit));
}

export async function openChatFromDom(page: Page, chatId: string): Promise<void> {
  const active = await page.locator('div[data-is-dropzone="true"][data-mid]').first().getAttribute('data-mid').catch(() => null);
  if (active === chatId) return;

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Go chatroom"]');
    let scroller = button?.parentElement ?? null;
    while (scroller) {
      if (scroller.scrollHeight > scroller.clientHeight + 8) {
        scroller.scrollTop = 0;
        return;
      }
      scroller = scroller.parentElement;
    }
  });
  await page.waitForTimeout(20);

  for (let i = 0; i < 100; i += 1) {
    const state = await page.evaluate((targetId) => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Go chatroom"]')];
      for (const button of buttons) {
        const row = button.closest<HTMLElement>('[data-mid]');
        if (row?.dataset.mid === targetId) {
          button.click();
          return { clicked: true, done: true };
        }
      }

      let scroller = buttons[0]?.parentElement ?? null;
      while (scroller) {
        if (scroller.scrollHeight > scroller.clientHeight + 8) break;
        scroller = scroller.parentElement;
      }
      if (!scroller) return { clicked: false, done: true };
      const before = scroller.scrollTop;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(max, before + Math.max(160, Math.floor(scroller.clientHeight * 0.8)));
      return { clicked: false, done: scroller.scrollTop >= max - 2 || scroller.scrollTop === before };
    }, chatId);

    if (state.clicked) {
      await page.waitForFunction(
        (targetId) => document.querySelector<HTMLElement>('div[data-is-dropzone="true"][data-mid]')?.dataset.mid === targetId,
        chatId,
        { timeout: 5_000 }
      );
      return;
    }
    if (state.done) break;
    await page.waitForTimeout(20);
  }

  throw new GatewayError('CHAT_NOT_FOUND', `Chat ${chatId} was not found in the chat list.`, 404);
}
