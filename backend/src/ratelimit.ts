// Fixed-window rate limiting per client (IP + authenticated wallet when present).
// ponytail: in-memory, single instance; use a shared store (e.g. Redis) when running more than one backend replica.
import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

export function rateLimit(name: string, opts: { windowSec: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }
    const wallet = (res.locals.wallet as string | undefined) ?? "";
    const key = `${req.ip}|${wallet}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowSec * 1000 };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, opts.max - b.count)));
    if (b.count > opts.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: { code: "RATE_LIMITED", message: `Too many requests. Try again in ${retry}s.`, details: { limit: name } } });
      return;
    }
    next();
  };
}
