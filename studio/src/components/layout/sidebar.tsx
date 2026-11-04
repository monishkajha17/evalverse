"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Beaker,
  Database,
  FlaskConical,
  Gavel,
  LayoutDashboard,
  ListTree,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/traces/", label: "Traces", icon: ListTree },
  { href: "/experiments/", label: "Experiments", icon: FlaskConical },
  { href: "/datasets/", label: "Datasets", icon: Database },
  { href: "/evaluators/", label: "Evaluators", icon: Beaker },
  { href: "/judge/", label: "Judge", icon: Gavel },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-white">
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Scale className="h-4 w-4 text-teal" />
        <div>
          <div className="text-sm font-semibold leading-none text-ink">EvalVerse</div>
          <div className="text-[10px] uppercase tracking-wide text-ink/45">Studio</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Primary">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30",
                active
                  ? "bg-ink text-white"
                  : "text-ink/70 hover:bg-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-2 text-[10px] leading-snug text-ink/45">
        Evaluation data: CORD v2 (CC BY 4.0)
      </div>
    </aside>
  );
}
