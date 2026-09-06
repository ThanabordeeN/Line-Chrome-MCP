import assert from 'node:assert/strict';
import test from 'node:test';
import { SerialQueue } from '../src/core/queue.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('SerialQueue executes UI work in order', async () => {
  const queue = new SerialQueue();
  const order: number[] = [];
  const first = queue.run(async () => {
    await sleep(20);
    order.push(1);
    return 'first';
  });
  const second = queue.run(async () => {
    order.push(2);
    return 'second';
  });
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.deepEqual(order, [1, 2]);
  assert.equal(queue.size, 0);
});
