"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function JudgeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/evaluators/?tab=judge");
  }, [router]);
  return (
    <>
      <Topbar title="Evaluators" />
      <main className="p-4">
        <LoadingState label="Opening judge trust" />
      </main>
    </>
  );
}
