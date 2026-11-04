"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Beaker,
  ClipboardCheck,
  Database,
  FlaskConical,
  LayoutDashboard,
  ListTree,
  Menu,
  Play,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
};

type NavGroup = { label?: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    items: [{ href: "/overview/", label: "Home", icon: LayoutDashboard }],
  },
  {
    label: "Observe",
    items: [
      { href: "/traces/", label: "Traces", icon: ListTree },
      { href: "/sessions/", label: "Sessions", icon: Users },
    ],
  },
  {
    items: [{ href: "/playground/", label: "Playground", icon: Play }],
  },
  {
    label: "Evaluate",
    items: [
      { href: "/evaluators/", label: "Evaluators", icon: Beaker },
      { href: "/online-evaluation/", label: "Online evaluation", icon: Shield },
      { href: "/human-review/", label: "Human review", icon: ClipboardCheck },
      { href: "/runs/", label: "Runs", icon: Sparkles },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/datasets/", label: "Datasets", icon: Database },
      { href: "/experiments/", label: "Experiments", icon: FlaskConical },
    ],
  },
  {
    items: [{ href: "/settings/", label: "Settings", icon: Settings }],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.match) return item.match(pathname);
  const base = item.href.replace(/\/$/, "");
  return pathname === item.href || pathname === base || pathname.startsWith(`${base}/`);
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();

  const nav = (
    <>
      <Link
        href="/overview/"
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border px-3 hover:bg-muted/60",
          collapsed ? "justify-center" : "gap-2",
        )}
        onClick={onCloseMobile}
      >
        <span className={cn("font-semibold tracking-tight text-ink", collapsed ? "text-sm" : "text-sm")}>
          {collapsed ? "EV" : "EvalVerse"}
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-3 overflow-auto p-2" aria-label="Primary">
        {GROUPS.map((group, gi) => (
          <div key={group.label || `g-${gi}`}>
            {group.label && !collapsed ? (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
                {group.label}
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    onClick={onCloseMobile}
                    className={cn(
                      "flex items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30",
                      collapsed ? "justify-center px-2 py-2" : "gap-2 px-2.5 py-1.5",
                      active ? "bg-ink text-white" : "text-ink/70 hover:bg-muted hover:text-ink",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop / tablet rail */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-white nav:flex",
          collapsed ? "w-14" : "w-52",
        )}
      >
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 nav:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={onCloseMobile}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-panel">
            <div className="flex h-12 items-center justify-between border-b border-border px-3">
              <span className="text-sm font-semibold text-ink">EvalVerse</span>
              <button type="button" className="rounded p-1 hover:bg-muted" onClick={onCloseMobile} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-auto">{nav}</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white text-ink nav:hidden"
      onClick={onClick}
      aria-label="Open menu"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
