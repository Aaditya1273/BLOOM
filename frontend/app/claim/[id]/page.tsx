"use client";

import { use, useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-api";
import { ClaimCard } from "@/components/bloom/claim-card";
import { ErrorState, Skeleton } from "@/components/bloom/states";

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [fetchClaim] = useState(() => () => api.claim(id));
  const claim = useQuery(fetchClaim);
  const risk = useQuery(api.risk);
  const price = risk.data?.assets.find((a) => a.symbol === claim.data?.symbol)?.priceUsd;

  return (
    <div className="mx-auto max-w-lg">
      {claim.loading ? (
        <Skeleton className="h-[28rem] rounded-card" />
      ) : claim.error || !claim.data ? (
        <ErrorState error={claim.error} onRetry={claim.reload} />
      ) : (
        <ClaimCard claim={claim.data} priceUsd={price ? Number(price) : undefined} onClaimed={claim.reload} />
      )}
    </div>
  );
}
