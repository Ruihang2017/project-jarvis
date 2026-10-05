/**
 * Jobs that take turns, with a pause after each. Gmail counts requests per minute, so the bill scan,
 * the booking scan and the mail summary must not all start in the minute Edward is opened.
 */
export class Turns {
  private last: Promise<unknown> = Promise.resolve();
  private freeAt = 0;

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms).unref()),
  ) {}

  /** Runs `job` after the ones before it, and not sooner than the gap after the last one ended. */
  run<T>(job: () => Promise<T>): Promise<T> {
    const mine = this.last.then(async () => {
      const wait = this.freeAt - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await job();
      } finally {
        this.freeAt = this.now() + this.gapMs;
      }
    });
    this.last = mine.catch(() => {});
    return mine;
  }
}
