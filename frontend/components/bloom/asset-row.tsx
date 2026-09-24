import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Monogram token avatar. Pink wash only for the brand's own products (cash, savings). */
export function AssetAvatar({ symbol, brand, children }: { symbol: string; brand?: boolean; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full text-xs font-semibold tracking-tight [&_svg]:size-[18px]",
        brand ? "bg-pink-soft text-ink" : "bg-sunken text-ink",
      )}
    >
      {children ?? symbol.slice(0, 4)}
    </span>
  );
}

export function Movement({ bps }: { bps: number | null | undefined }) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null;
  const up = bps >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="tabular inline-flex items-center gap-0.5 text-xs text-muted" aria-label={`${up ? "Up" : "Down"} ${Math.abs(bps / 100).toFixed(2)}% in 24 hours`}>
      <Icon className={cn("size-3.5", up ? "text-success" : "text-danger")} />
      {Math.abs(bps / 100).toFixed(2)}%
    </span>
  );
}

/** One line of "Your money". No table: name + context left, value + allocation right. */
export function AssetRow({
  symbol,
  name,
  detail,
  valueUsd,
  allocation,
  movementBps,
  note,
  brand,
  icon,
}: {
  symbol: string;
  name: string;
  detail?: ReactNode;
  valueUsd: number;
  allocation?: number;
  movementBps?: number | null;
  note?: ReactNode;
  brand?: boolean;
  icon?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 py-4">
      <AssetAvatar symbol={symbol} brand={brand}>{icon}</AssetAvatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="tabular truncate text-sm text-muted">{detail}</p>
        {note && <div className="mt-1">{note}</div>}
      </div>
      <div className="text-right">
        <p className="tabular font-medium">{usd(valueUsd)}</p>
        <p className="flex items-center justify-end gap-2 text-xs text-muted">
          <Movement bps={movementBps} />
          {allocation !== undefined && <span className="tabular">{allocation < 1 && allocation > 0 ? "<1" : Math.round(allocation)}%</span>}
        </p>
      </div>
    </li>
  );
}
