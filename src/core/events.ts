import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface GatewayEvent<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  data: T;
}

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish<T>(type: string, data: T): GatewayEvent<T> {
    const event: GatewayEvent<T> = {
      id: `evt_${randomUUID()}`,
      type,
      occurredAt: new Date().toISOString(),
      data
    };
    this.emitter.emit('event', event);
    return event;
  }

  subscribe(listener: (event: GatewayEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
