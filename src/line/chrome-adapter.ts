import { chromium, type Browser, type Page } from 'playwright-core';
import { GatewayError } from '../core/errors.js';
import type { GatewayCapabilities, GatewayStatus, SendMessageInput } from '../core/types.js';
import type { GetMessagesOptions, LineAdapter, LineAdapterEvent, ListChatsOptions } from './adapter.js';
import { listChatsFromDom } from './dom-chats.js';
import { getMessagesFromDom, sendTextFromDom } from './dom-messages.js';
import { startDomWatcher } from './dom-watch.js';

interface ChromeLineAdapterOptions {
  cdpUrl: string;
  extensionId?: string;
  maxHistoryScrolls: number;
}

export class ChromeLineAdapter implements LineAdapter {
  private browser: Browser | undefined;
  private page: Page | undefined;

  constructor(private readonly options: ChromeLineAdapterOptions) {}

  capabilities(): GatewayCapabilities {
    return {
      read: { chats: true, messages: true, imageMetadata: true, stickerMetadata: true, replies: false },
      write: { text: true, reply: false, file: false, image: false, reaction: false },
      transports: { rest: true, sseEvents: true, mcpStdio: true, mcpStreamableHttp: true }
    };
  }

  async status(): Promise<GatewayStatus> {
    try {
      const page = await this.ensurePage(false);
      if (!page) {
        return {
          ready: false,
          connected: Boolean(this.browser?.isConnected()),
          reason: 'LINE extension page not found. Open LINE in the dedicated Chrome profile.'
        };
      }
      const activeChatId = await page.locator('div[data-is-dropzone="true"][data-mid]').first().getAttribute('data-mid').catch(() => null);
      return {
        ready: true,
        connected: true,
        pageUrl: page.url(),
        ...(activeChatId ? { activeChatId } : {})
      };
    } catch (error) {
      return { ready: false, connected: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async listChats(options: ListChatsOptions = {}) {
    return listChatsFromDom(await this.requirePage(), options);
  }

  async getMessages(chatId: string, options: GetMessagesOptions = {}) {
    return getMessagesFromDom(await this.requirePage(), chatId, options, this.options.maxHistoryScrolls);
  }

  async sendMessage(input: SendMessageInput) {
    return sendTextFromDom(await this.requirePage(), input);
  }

  async startWatching(listener: (event: LineAdapterEvent) => void): Promise<() => void> {
    return startDomWatcher(() => this.ensurePage(false), listener);
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
    this.page = undefined;
  }

  private async requirePage(): Promise<Page> {
    const page = await this.ensurePage(true);
    if (!page) throw new GatewayError('LINE_PAGE_NOT_FOUND', 'LINE extension page not found.', 503);
    return page;
  }

  private async ensurePage(throwOnConnectError: boolean): Promise<Page | undefined> {
    if (this.page && !this.page.isClosed()) return this.page;
    try {
      if (!this.browser?.isConnected()) this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
      const pages = this.browser.contexts().flatMap((context) => context.pages());

      if (this.options.extensionId) {
        const exact = pages.find((page) => page.url().startsWith(`chrome-extension://${this.options.extensionId}/`));
        if (exact) {
          this.page = exact;
          return exact;
        }
      }

      for (const page of pages) {
        if (!page.url().startsWith('chrome-extension://')) continue;
        const matches = await page
          .locator('button[aria-label="Go chatroom"], textarea-ex[placeholder="Enter a message"]')
          .count()
          .catch(() => 0);
        if (matches > 0) {
          this.page = page;
          return page;
        }
      }
      return undefined;
    } catch (error) {
      if (throwOnConnectError) {
        throw new GatewayError(
          'CDP_CONNECTION_FAILED',
          `Could not connect to Chrome DevTools at ${this.options.cdpUrl}: ${error instanceof Error ? error.message : String(error)}`,
          503
        );
      }
      return undefined;
    }
  }
}
