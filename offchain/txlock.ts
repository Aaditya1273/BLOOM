// Process-wide per-key async lock. Backend and the in-process reporter both sign with the deployer key
// (feed admin / minter), so every send goes through here and waits for its receipt before the next one.
// ponytail: in-process only; run one process per key (use a real nonce service if you scale out).
const tails = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = key.toLowerCase();
  const prev = tails.get(k) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(k, run.catch(() => undefined));
  return run;
}
