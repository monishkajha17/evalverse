"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { CommandPalette } from "@/components/studio/command-palette";
import { ConnectionBanners } from "@/components/studio/connection-banners";
import { Sidebar } from "@/components/layout/sidebar";

const COLLAPSE_MQ = "(max-width: 1199px)";
const DRAWER_MQ = "(max-width: 820px)";

const MobileNavCtx = createContext<{ open: () => void }>({ open: () => {} });
const SidebarCollapseCtx = createContext(false);

export function useOpenMobileNav() {
  return useContext(MobileNavCtx);
}

export function useSidebarCollapsed() {
  return useContext(SidebarCollapseCtx);
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const collapseMq = window.matchMedia(COLLAPSE_MQ);
    const drawerMq = window.matchMedia(DRAWER_MQ);
    const sync = () => {
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

  return (
    <MobileNavCtx.Provider value={{ open: () => setMobileOpen(true) }}>
      <SidebarCollapseCtx.Provider value={collapsed}>
        <div className="studio flex min-h-screen min-w-0 overflow-x-hidden bg-paper text-ink">
          <Sidebar
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
            <ConnectionBanners />
            <div className="mx-auto w-full max-w-[1440px] min-w-0 flex-1">{children}</div>
          </div>
          <CommandPalette />
        </div>
      </SidebarCollapseCtx.Provider>
    </MobileNavCtx.Provider>
  );
}
