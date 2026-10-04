/**
 * Several paged lists (one per account) read as one list, newest first (F1a). Each source is read a
 * page at a time. An item is only given out while every source that still has more has something
 * buffered, so a later page can never hold something newer than what was already given out.
 */
export interface PagedSource<T> {
  /** Says where the item came from (an account id). */
  key: string;
  fetch(token?: string): Promise<{ items: T[]; next?: string }>;
}

export class MergedList<T> {
  private boxes: { src: PagedSource<T>; buffer: T[]; token?: string; done: boolean }[];
  /** "<key>: <message>" for sources that failed; they are skipped from then on. */
  readonly problems: { key: string; error: unknown }[] = [];

  constructor(
    sources: PagedSource<T>[],
    private readonly time: (item: T) => number,
  ) {
    this.boxes = sources.map((src) => ({ src, buffer: [], done: false }));
  }

  /** Whether anything is left. */
  get more(): boolean {
    return this.boxes.some((b) => b.buffer.length || !b.done);
  }

  private async fill() {
    await Promise.all(
      this.boxes
        .filter((b) => !b.done && !b.buffer.length)
        .map(async (b) => {
          try {
            const page = await b.src.fetch(b.token);
            b.buffer.push(...[...page.items].sort((x, y) => this.time(y) - this.time(x)));
            b.token = page.next;
            b.done = !page.next;
          } catch (error) {
            b.done = true;
            this.problems.push({ key: b.src.key, error });
          }
        }),
    );
  }

  /** Up to `n` more items, newest first, each with its source's key. */
  async next(n: number): Promise<{ key: string; item: T }[]> {
    const out: { key: string; item: T }[] = [];
    while (out.length < n) {
      await this.fill();
      // A page can come back empty with more to follow: read on before choosing.
      if (this.boxes.some((b) => !b.done && !b.buffer.length)) continue;
      const ready = this.boxes.filter((b) => b.buffer.length);
      if (!ready.length) break;
      const newest = ready.reduce((x, y) => (this.time(y.buffer[0]!) > this.time(x.buffer[0]!) ? y : x));
      out.push({ key: newest.src.key, item: newest.buffer.shift()! });
    }
    return out;
  }
}
