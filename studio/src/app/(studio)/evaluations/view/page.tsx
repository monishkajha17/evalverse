"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function EvaluationViewRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/runs/${qs}`);
  }, [router]);
  return (
    <>
      <Topbar title="Runs" />
      <main className="p-4">
        <LoadingState label="Opening run" />
      </main>
    </>
  );
}
