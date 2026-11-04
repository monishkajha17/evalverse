"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function PoliciesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/online-evaluation/");
  }, [router]);
  return (
    <>
      <Topbar title="Online evaluation" />
      <main className="p-4">
        <LoadingState label="Opening online evaluation" />
      </main>
    </>
  );
}
