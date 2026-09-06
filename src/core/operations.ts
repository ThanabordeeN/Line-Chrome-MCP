import { randomUUID } from 'node:crypto';
import type { Operation } from './types.js';
import { asGatewayError } from './errors.js';
import { EventBus } from './events.js';
import { SerialQueue } from './queue.js';

export class OperationStore {
  private readonly operations = new Map<string, Operation>();
  private readonly idempotency = new Map<string, string>();

  constructor(
    private readonly queue: SerialQueue,
    private readonly events: EventBus
  ) {}

  get(id: string): Operation | undefined {
    return this.operations.get(id);
  }

  enqueue<T>(type: string, task: () => Promise<T>, idempotencyKey?: string): Operation<T> {
    if (idempotencyKey) {
      const existingId = this.idempotency.get(idempotencyKey);
      const existing = existingId ? this.operations.get(existingId) : undefined;
      if (existing) return existing as Operation<T>;
    }

    const operation: Operation<T> = {
      id: `op_${randomUUID()}`,
      type,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    this.operations.set(operation.id, operation);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, operation.id);
    this.events.publish('operation.created', operation);

    void this.queue.run(async () => {
      operation.status = 'running';
      operation.startedAt = new Date().toISOString();
      this.events.publish('operation.started', operation);
      try {
        operation.result = await task();
        operation.status = 'succeeded';
        operation.completedAt = new Date().toISOString();
        this.events.publish('operation.succeeded', operation);
      } catch (error) {
        const mapped = asGatewayError(error);
        operation.status = 'failed';
        operation.completedAt = new Date().toISOString();
        operation.error = { code: mapped.code, message: mapped.message };
        this.events.publish('operation.failed', operation);
      }
    });

    return operation;
  }
}
