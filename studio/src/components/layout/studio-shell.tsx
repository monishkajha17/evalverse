"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { OfflineBanner } from "@/components/studio/page-chrome";
import { Sidebar } from "@/components/layout/sidebar";
import { useApiMode } from "@/context/api-mode";

const COLLAPSE_MQ = "(max-width: 1199px)";
const DRAWER_MQ = "(max-width: 820px)";

const MobileNavCtx = createContext<{ open: () => void }>({ open: () => {} });

export function useOpenMobileNav() {
  return useContext(MobileNavCtx);
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const { preferLive, liveAvailable, signedIn, refresh, mode } = useApiMode();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const collapseMq = window.matchMedia(COLLAPSE_MQ);
    const drawerMq = window.matchMedia(DRAWER_MQ);
    const sync = () => {
      // Icon-only under 1200px (but still a rail when above drawer breakpoint).
      setCollapsed(collapseMq.matches && !drawerMq.matches);
      if (!drawerMq.matches) setMobileOpen(false);
    };
    sync();
    collapseMq.addEventListener("change", sync);
    drawerMq.addEventListener("change", sync);
    return () => {
      collapseMq.removeEventListener("change", sync);
      drawerMq.removeEventListener("change", sync);
    };
  }, []);

  const showOffline = Boolean(signedIn && preferLive && !liveAvailable && mode !== "live");

  return (
    <MobileNavCtx.Provider value={{ open: () => setMobileOpen(true) }}>
      <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-paper text-ink">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
          {showOffline ? <OfflineBanner onRetry={refresh} /> : null}
          {children}
        </div>
      </div>
    </MobileNavCtx.Provider>
  );
}
