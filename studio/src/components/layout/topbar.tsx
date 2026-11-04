"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, CircleHelp, LogOut, Settings, UserRound } from "lucide-react";
import { DataSourceControl } from "@/components/studio/data-source-control";
import { MobileMenuButton } from "@/components/layout/sidebar";
import { useOpenMobileNav } from "@/components/layout/studio-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiMode } from "@/context/api-mode";
import { clearSession, readSession } from "@/lib/session";

const TITLES: Array<{ match: RegExp; title: string; crumbs?: string[] }> = [
  { match: /^\/overview\/?$/, title: "Home", crumbs: ["Home"] },
  { match: /^\/traces/, title: "Traces", crumbs: ["Observe", "Traces"] },
  { match: /^\/sessions\/view/, title: "Session", crumbs: ["Observe", "Sessions"] },
  { match: /^\/sessions/, title: "Sessions", crumbs: ["Observe", "Sessions"] },
  { match: /^\/playground/, title: "Playground", crumbs: ["Playground"] },
  { match: /^\/evaluators/, title: "Evaluators", crumbs: ["Evaluate", "Evaluators"] },
  { match: /^\/online-evaluation/, title: "Online evaluation", crumbs: ["Evaluate", "Online evaluation"] },
  { match: /^\/human-review/, title: "Human review", crumbs: ["Evaluate", "Human review"] },
  { match: /^\/runs/, title: "Runs", crumbs: ["Evaluate", "Runs"] },
  { match: /^\/datasets/, title: "Datasets", crumbs: ["Data", "Datasets"] },
  { match: /^\/experiments/, title: "Experiments", crumbs: ["Data", "Experiments"] },
  { match: /^\/settings/, title: "Settings", crumbs: ["Settings"] },
];

export function Topbar({
  title: titleProp,
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { disconnect } = useApiMode();
  const mobileNav = useOpenMobileNav();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(readSession()?.email || null);
  }, [pathname]);

  const meta = useMemo(() => {
    const hit = TITLES.find((t) => t.match.test(pathname || ""));
    return hit || { title: titleProp || "Studio", crumbs: [titleProp || "Studio"] };
  }, [pathname, titleProp]);

  function onSignOut() {
    clearSession();
    disconnect();
    router.push("/signin/");
  }

  return (
    <header className="sticky top-0 z-20 flex h-12 min-w-0 items-center gap-2 border-b border-border bg-paper/95 px-3 backdrop-blur sm:px-4">
      <MobileMenuButton onClick={mobileNav.open} />

      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1 text-[11px] text-ink/45">
          {(meta.crumbs || [meta.title]).map((c, i, arr) => (
            <span key={`${c}-${i}`} className="inline-flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3 w-3 shrink-0 opacity-60" /> : null}
              <span className={cnTruncate(i === arr.length - 1)}>{c}</span>
            </span>
          ))}
        </div>
        <h1 className="truncate text-sm font-semibold text-ink">{titleProp || meta.title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {children}
        <DataSourceControl />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label="Help" className="h-8 w-8 px-0">
              <CircleHelp className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Help</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/docs/">Docs</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/quickstart/">Quickstart</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="https://github.com/evalverse/evalverse" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label="Account" className="h-8 gap-1.5 px-2">
              <UserRound className="h-4 w-4" />
              <span className="hidden max-w-[120px] truncate text-xs md:inline">
                {email || "Account"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{email || "Not signed in"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/" className="flex items-center gap-2">
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            </DropdownMenuItem>
            {email ? (
              <DropdownMenuItem onSelect={onSignOut} className="flex items-center gap-2">
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem asChild>
                <Link href="/signin/">Sign in</Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function cnTruncate(strong: boolean) {
  return strong ? "truncate font-medium text-ink/70" : "truncate";
}
