"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function ReviewRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/human-review/");
  }, [router]);
  return (
    <>
      <Topbar title="Human review" />
      <main className="p-4">
        <LoadingState label="Opening human review" />
      </main>
    </>
  );
}
