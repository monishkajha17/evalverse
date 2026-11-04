"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

/** System moved to docs; keep URL as a redirect. */
export default function SystemRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/docs/architecture/");
  }, [router]);
  return (
    <>
      <Topbar title="Architecture" />
      <main className="p-4">
        <LoadingState label="Opening architecture docs" />
      </main>
    </>
  );
}
