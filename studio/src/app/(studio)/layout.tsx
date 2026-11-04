"use client";

import { SuiteProvider } from "@/context/suite-context";
import { StudioShell } from "@/components/layout/studio-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <SuiteProvider>
      <TooltipProvider delayDuration={200}>
        <StudioShell>{children}</StudioShell>
      </TooltipProvider>
    </SuiteProvider>
  );
}
