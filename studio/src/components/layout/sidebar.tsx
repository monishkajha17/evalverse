"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Beaker,
  ClipboardCheck,
  Database,
  FlaskConical,
  Gavel,
  LayoutDashboard,
  ListTree,
  Network,
  Scale,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    label: "Observe",
    items: [
      { href: "/overview/", label: "Overview", icon: LayoutDashboard },
      { href: "/sessions/", label: "Sessions", icon: Users },
      { href: "/traces/", label: "Traces", icon: ListTree },
      { href: "/system/", label: "System", icon: Network },
    ],
  },
  {
    label: "Evaluate",
    items: [
      { href: "/evaluators/", label: "Evaluators", icon: Beaker },
      { href: "/evaluations/", label: "Evaluations", icon: Sparkles },
      { href: "/policies/", label: "Policies", icon: Shield },
      { href: "/review/", label: "Review", icon: ClipboardCheck },
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
    label: "Judge",
    items: [{ href: "/judge/", label: "Judge", icon: Gavel }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-white">
      <Link href="/" className="flex h-12 items-center gap-2 border-b border-border px-3 hover:bg-muted/60">
        <Scale className="h-4 w-4 text-teal" />
        <div>
          <div className="text-sm font-semibold leading-none text-ink">EvalVerse</div>
          <div className="text-[10px] uppercase tracking-wide text-ink/45">Studio</div>
        </div>
      </Link>
      <nav className="flex flex-1 flex-col gap-3 overflow-auto p-2" aria-label="Primary">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href.replace(/\/$/, "") + "/") ||
                  pathname === item.href.replace(/\/$/, "");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30",
                      active ? "bg-ink text-white" : "text-ink/70 hover:bg-muted hover:text-ink",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-2 text-[10px] leading-snug text-ink/45">
        Evaluation data: CORD v2 (CC BY 4.0)
      </div>
    </aside>
  );
}
