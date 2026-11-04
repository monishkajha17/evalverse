"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Connect moved under Settings → Connect a self-hosted server. */
export default function ConnectRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/");
  }, [router]);
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-sm text-[var(--mk-muted)]">
      Redirecting to Settings…
    </div>
  );
}
