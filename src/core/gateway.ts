import type { GetMessagesOptions, LineAdapter, ListChatsOptions } from '../line/adapter.js';
import type { SendMessageInput } from './types.js';
import { GatewayError } from './errors.js';
import { EventBus } from './events.js';
import { OperationStore } from './operations.js';
import { SerialQueue } from './queue.js';

export class MessagingGateway {
  private stopWatching: (() => void) | undefined;
  readonly events = new EventBus();
  private readonly uiQueue = new SerialQueue();
  readonly operations = new OperationStore(this.uiQueue, this.events);

  constructor(public readonly adapter: LineAdapter) {}

  async start(): Promise<void> {
    if (!this.adapter.startWatching || this.stopWatching) return;
    this.stopWatching = await this.adapter.startWatching((event) => {
      this.events.publish(event.type, event.data);
    });
  }

  status() {
    return this.adapter.status();
  }

  capabilities() {
    return this.adapter.capabilities();
  }

  listChats(options?: ListChatsOptions) {
    return this.uiQueue.run(() => this.adapter.listChats(options));
  }

  getMessages(chatId: string, options?: GetMessagesOptions) {
    return this.uiQueue.run(() => this.adapter.getMessages(chatId, options));
  }

  sendMessage(input: SendMessageInput) {
    const capabilities = this.adapter.capabilities();
    if (!capabilities.write.text) {
      throw new GatewayError('CAPABILITY_NOT_SUPPORTED', 'Text sending is not supported by the active LINE adapter.', 422);
    }
    if (input.replyTo && !capabilities.write.reply) {
      throw new GatewayError('CAPABILITY_NOT_SUPPORTED', 'Reply sending is not supported by the active LINE adapter.', 422);
    }
    return this.operations.enqueue(
      'message.send',
      async () => {
        const result = await this.adapter.sendMessage(input);
        this.events.publish('message.sent', { chatId: input.chatId, ...result });
        return result;
      },
      input.idempotencyKey
    );
  }

  getOperation(id: string) {
    return this.operations.get(id);
  }

  async close() {
    this.stopWatching?.();
    this.stopWatching = undefined;
    await this.adapter.close();
  }
}
