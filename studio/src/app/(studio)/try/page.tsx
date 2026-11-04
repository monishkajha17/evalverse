"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/studio/page-chrome";
import { Topbar } from "@/components/layout/topbar";

export default function TryRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/playground/");
  }, [router]);
  return (
    <>
      <Topbar title="Playground" />
      <main className="p-4">
        <LoadingState label="Opening playground" />
      </main>
    </>
  );
}
