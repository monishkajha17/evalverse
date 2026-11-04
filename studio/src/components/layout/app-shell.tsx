"use client";

import { SuiteProvider } from "@/context/suite-context";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SuiteProvider>
      <div className="flex min-h-screen bg-paper text-ink">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SuiteProvider>
  );
}
