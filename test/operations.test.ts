import assert from 'node:assert/strict';
import test from 'node:test';
import { EventBus } from '../src/core/events.js';
import { OperationStore } from '../src/core/operations.js';
import { SerialQueue } from '../src/core/queue.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('OperationStore deduplicates idempotency keys', async () => {
  const store = new OperationStore(new SerialQueue(), new EventBus());
  let calls = 0;
  const a = store.enqueue('test', async () => {
    calls += 1;
    return { ok: true };
  }, 'same-key');
  const b = store.enqueue('test', async () => {
    calls += 1;
    return { ok: true };
  }, 'same-key');
  assert.equal(a.id, b.id);
  await sleep(10);
  assert.equal(calls, 1);
  assert.equal(store.get(a.id)?.status, 'succeeded');
});
