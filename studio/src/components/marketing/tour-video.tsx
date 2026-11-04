"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";

/**
 * Product tour slot. Renders <video controls> when NEXT_PUBLIC_TOUR_URL is set
 * or /media/tour.mp4 exists; otherwise a placeholder.
 */
export function TourVideo() {
  const envUrl = process.env.NEXT_PUBLIC_TOUR_URL || "";
  const [src, setSrc] = useState<string | null>(envUrl || null);
  const [checked, setChecked] = useState(!!envUrl);

  useEffect(() => {
    if (envUrl) {
      setSrc(envUrl);
      setChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/media/tour.mp4", { method: "HEAD" });
        if (!cancelled && res.ok) setSrc("/media/tour.mp4");
      } catch {
        /* no video yet */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envUrl]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6">
      <div className="mk-panel relative aspect-video overflow-hidden">
        {src ? (
          <video className="h-full w-full object-cover" controls preload="metadata" poster="">
            <source src={src} />
            Your browser does not support embedded video.
          </video>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,rgba(142,197,255,0.08),transparent_60%)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--mk-outline)] bg-[rgba(10,18,32,0.8)]">
              <Play className="h-5 w-5 text-[var(--mk-accent)]" aria-hidden />
            </div>
            <p className="mk-mono text-sm text-[var(--mk-muted)]">
              {checked ? "Tour coming soon" : "Checking for tour…"}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-center mk-mono text-xs text-[var(--mk-muted)]">Product tour</p>
    </div>
  );
}
