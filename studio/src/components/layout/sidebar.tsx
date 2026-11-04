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
import { Hint } from "@/components/ui/tooltip";
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

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-2.5 py-1.5",
        active ? "font-medium" : "",
      )}
    >
      {active ? (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Hint label={item.label}>
      <div>{link}</div>
    </Hint>
  );
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
  const nav = (isCollapsed: boolean) => (
    <>
      <Link
        href="/overview/"
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-hairline px-3 hover:bg-muted/60",
          isCollapsed ? "justify-center" : "gap-2",
        )}
        onClick={onCloseMobile}
      >
        <span data-studio-brand className="text-sm font-semibold tracking-tight">
          {isCollapsed ? "EV" : "EvalVerse"}
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-3 overflow-auto p-2" aria-label="Primary">
        {GROUPS.map((group, gi) => (
          <div key={group.label || `g-${gi}`}>
            {group.label && !isCollapsed ? (
              <div className="label-mono studio-nav-group mb-1 px-2">{group.label}</div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={isCollapsed}
                  onNavigate={onCloseMobile}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <>
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-hairline bg-surface nav:flex",
          collapsed ? "w-14" : "w-52",
        )}
      >
        {nav(collapsed)}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 nav:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={onCloseMobile}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-panel">
            <div className="flex h-12 items-center justify-between border-b border-hairline px-3">
              <span data-studio-brand className="text-sm font-semibold">EvalVerse</span>
              <button
                type="button"
                className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink"
                onClick={onCloseMobile}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-auto">{nav(false)}</div>
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-ink nav:hidden"
      onClick={onClick}
      aria-label="Open menu"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
