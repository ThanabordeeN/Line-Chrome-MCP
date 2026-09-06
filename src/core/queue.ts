export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;

  get size(): number {
    return this.queued;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => {
      this.queued -= 1;
    });
  }
}
