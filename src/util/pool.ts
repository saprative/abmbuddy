/**
 * Minimal concurrency limiter. Deliberately not a dependency: the whole tool
 * fans out over a handful of accounts, not thousands of jobs.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const max = Math.max(1, Math.min(limit, items.length || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: max }, run));
  return results;
}

/** Per-host politeness: serialize requests to a host with a minimum gap. */
export class RateLimiter {
  private readonly last = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly minGapMs: number) {}

  async acquire(key: string): Promise<void> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.chains.set(
      key,
      previous.then(() => current),
    );
    await previous;
    const since = Date.now() - (this.last.get(key) ?? 0);
    if (since < this.minGapMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minGapMs - since));
    }
    this.last.set(key, Date.now());
    // Release the next waiter on the next tick; callers do not hold the slot
    // for the duration of their request, only for the spacing window.
    setTimeout(release, 0);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
