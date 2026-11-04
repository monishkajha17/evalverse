"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiMode } from "@/context/api-mode";

export function ConnectionBanners() {
  const { banner, refresh, switchToDemo, clearSessionExpired, signedIn, preferLive, mode } =
    useApiMode();
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!banner) return null;

  if (banner.kind === "session-expired") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-crimson/30 bg-crimson/10 px-4 py-2 text-xs text-ink">
        <span>
          <span className="font-medium">Your session expired.</span> Sign in again
        </span>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link
              href="/signin/"
              onClick={() => clearSessionExpired()}
            >
              Sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (banner.kind === "unreachable") {
    return (
      <div className="border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs text-ink">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium">Can&apos;t reach your server.</span> Showing demo data until
            the connection returns.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={switchToDemo}>
              Use demo data
            </Button>
          </div>
        </div>
        {banner.detail ? (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Details
            </button>
            {detailsOpen ? (
              <pre className="mono mt-1 max-h-24 overflow-auto rounded border border-hairline bg-raised p-2 text-[10px] text-ink-muted">
                {banner.detail}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // Demo banner — signed out, or signed in exploring demo
  if (mode === "live") return null;
  if (signedIn && preferLive) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-raised/80 px-4 py-1.5 text-xs text-ink-muted">
      <span>
        Showing recorded results.
        {!signedIn ? (
          <>
            {" "}
            <Link href="/signin/" className="font-medium text-accent hover:underline">
              Sign in
            </Link>{" "}
            to see your own traces.
          </>
        ) : (
          " Switch back to your project anytime from the account menu."
        )}
      </span>
    </div>
  );
}
