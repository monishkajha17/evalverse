"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function EvaluationsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/runs/");
  }, [router]);
  return (
    <>
      <Topbar title="Runs" />
      <main className="p-4">
        <LoadingState label="Opening runs" />
      </main>
    </>
  );
}
