"use client";

import Link from "next/link";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";

const GITHUB = "https://github.com/monishkajha17/evalverse";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Scale className="h-4 w-4 text-teal" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">EvalVerse</span>
        </Link>
        <nav className="ml-auto flex flex-wrap items-center gap-1 sm:gap-2" aria-label="Marketing">
          <Link
            href="/quickstart/"
            className="rounded-md px-2.5 py-1.5 text-sm text-ink/70 hover:bg-muted hover:text-ink"
          >
            Quickstart
          </Link>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2.5 py-1.5 text-sm text-ink/70 hover:bg-muted hover:text-ink"
          >
            GitHub
          </a>
          <Button asChild variant="outline" size="sm">
            <Link href="/overview/">Open demo</Link>
          </Button>
          <Button asChild variant="teal" size="sm">
            <Link href="/connect/">Connect</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
