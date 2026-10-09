const tails = new Map<string, Promise<unknown>>();
const lastStart = new Map<string, number>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Serialises calls so at most one starts per intervalMs (default 1000). Per host key. */
export function rateLimited<T>(key: string, fn: () => Promise<T>, intervalMs = 1000): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(async () => {
    const last = lastStart.get(key);
    if (last !== undefined) {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastStart.set(key, Date.now());
    return fn();
  });
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Test helper: forget all queues and timestamps. */
export function resetRateLimits(): void {
  tails.clear();
  lastStart.clear();
}
