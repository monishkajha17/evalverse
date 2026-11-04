"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  CircleHelp,
  Keyboard,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
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
import { useTheme } from "@/context/theme-context";
import { clearSession, readSession } from "@/lib/session";

/** Detail routes get breadcrumbs; list pages use page header only. */
const DETAIL_CRUMBS: Array<{ match: RegExp; crumbs: string[] }> = [
  { match: /^\/traces\/view/, crumbs: ["Observe", "Traces", "Detail"] },
  { match: /^\/traces\/[^/]+/, crumbs: ["Observe", "Traces", "Detail"] },
  { match: /^\/sessions\/view/, crumbs: ["Observe", "Sessions", "Detail"] },
];

export function Topbar({
  title: _titleProp,
  children,
  hideTitle,
}: {
  title?: string;
  children?: React.ReactNode;
  /** When true, leave the page title to PageHeader (avoids Home/Overview duplicate). */
  hideTitle?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { disconnect, signedIn, preferLive, switchToDemo, switchToLive, mode } = useApiMode();
  const { theme, setTheme } = useTheme();
  const mobileNav = useOpenMobileNav();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(readSession()?.email || null);
  }, [pathname, signedIn]);

  const crumbs = useMemo(() => {
    const hit = DETAIL_CRUMBS.find((t) => t.match.test(pathname || ""));
    return hit?.crumbs || null;
  }, [pathname]);

  function onSignOut() {
    clearSession();
    disconnect();
    router.push("/signin/");
  }

  return (
    <header className="sticky top-0 z-20 flex h-12 min-w-0 items-center gap-2 border-b border-hairline bg-surface/95 px-3 backdrop-blur sm:px-4">
      <MobileMenuButton onClick={mobileNav.open} />

      <div className="min-w-0 flex-1 overflow-hidden">
        {crumbs ? (
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-ink-muted">
            {crumbs.map((c, i, arr) => (
              <span key={`${c}-${i}`} className="inline-flex min-w-0 items-center gap-1">
                {i > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden /> : null}
                <span className={i === arr.length - 1 ? "truncate font-medium text-ink" : "truncate"}>
                  {c}
                </span>
              </span>
            ))}
          </div>
        ) : !hideTitle ? (
          <div className="h-4" aria-hidden />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {children}
        <DataSourceControl />

        {!signedIn ? (
          <Button asChild size="sm">
            <Link href="/signin/">Sign in</Link>
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label="Help" className="h-8 w-8 px-0">
              <CircleHelp className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="flex items-center gap-2 text-ink-muted">
              <Keyboard className="h-3.5 w-3.5" />
              ⌘/Ctrl K · Jump
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
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{email || "Not signed in"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-2"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light" : "Dark (beta)"}
            </DropdownMenuItem>
            {signedIn ? (
              preferLive && mode === "live" ? (
                <DropdownMenuItem onSelect={switchToDemo} className="flex items-center gap-2">
                  Switch to demo data
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={switchToLive} className="flex items-center gap-2">
                  Back to my project
                </DropdownMenuItem>
              )
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/settings/" className="flex items-center gap-2">
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            </DropdownMenuItem>
            {signedIn ? (
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
