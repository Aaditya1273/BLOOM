// Portfolio history for the home chart. Real snapshots only: a point is recorded whenever the account view is
// computed (at most every SNAPSHOT_EVERY_SEC per owner) — nothing is interpolated or invented.
// ponytail: JSON file store, capped per owner; move to a DB/indexer for real traffic.
import { jsonStore } from "./store.ts";

const SNAPSHOT_EVERY_SEC = 300;
const MAX_POINTS = 2000;
const DAY = 86_400;

type Point = { t: number; totalUsd: number; prices: Record<string, number> };
const store = jsonStore<Record<string, Point[]>>("history", {});

export function recordSnapshot(owner: string, totalUsd: number, prices: Record<string, number>) {
  const key = owner.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const pts = store.get()[key] ?? [];
  if (pts.length && now - pts[pts.length - 1].t < SNAPSHOT_EVERY_SEC) return;
  store.update((d) => {
    const list = (d[key] ??= []);
    list.push({ t: now, totalUsd, prices });
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
  });
}

/** Oldest point at or after `since`, else the oldest point overall. */
const baseline = (pts: Point[], since: number) => pts.find((p) => p.t >= since) ?? pts[0];

export function historyView(owner: string, current: { totalUsd: number; prices: Record<string, number> }) {
  const pts = store.get()[owner.toLowerCase()] ?? [];
  const now = Math.floor(Date.now() / 1000);
  const month = pts.length ? baseline(pts, now - 30 * DAY) : undefined;
  const day = pts.length ? baseline(pts, now - DAY) : undefined;
  const changes: Record<string, { changeBps: number | null; sinceSec: number | null }> = {};
  for (const [sym, price] of Object.entries(current.prices)) {
    const ref = day?.prices[sym];
    changes[sym] = ref && price
      ? { changeBps: Math.round(((price - ref) / ref) * 10_000), sinceSec: now - day!.t }
      : { changeBps: null, sinceSec: null };
  }
  return {
    points: [...pts.map((p) => ({ t: p.t, totalUsd: p.totalUsd })), { t: now, totalUsd: current.totalUsd }],
    // change in total value since the start of the window (includes deposits/withdrawals; labelled as such in the UI)
    windowChangeUsd: month ? +(current.totalUsd - month.totalUsd).toFixed(2) : null,
    windowSinceSec: month ? now - month.t : null,
    assetChanges: changes,
  };
}
