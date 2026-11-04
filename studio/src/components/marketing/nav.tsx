"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Scale, X } from "lucide-react";

const GITHUB = "https://github.com/monishkajha17/evalverse";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#code", label: "Code" },
  { href: "/quickstart/", label: "Docs" },
  { href: GITHUB, label: "GitHub", external: true },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mk-nav-shell">
      <nav className="mk-nav" aria-label="Marketing">
        <Link href="/" className="flex items-center gap-2 pr-2">
          <Scale className="h-4 w-4 text-[var(--mk-accent)]" aria-hidden />
          <span className="text-sm font-medium tracking-tight">EvalVerse</span>
        </Link>

        <div className="mk-nav-desktop ml-2 flex flex-1 items-center gap-0.5">
          {LINKS.map((l) =>
            l.external ? (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="mk-nav-link"
              >
                {l.label}
                <span aria-hidden className="ml-1 opacity-70">
                  ↗
                </span>
              </a>
            ) : (
              <Link key={l.href} href={l.href} className="mk-nav-link">
                {l.label}
              </Link>
            ),
          )}
        </div>

        <div className="mk-nav-desktop ml-auto flex items-center gap-2">
          <Link href="/overview/" className="mk-btn mk-btn-primary">
            Open Studio
          </Link>
          <Link href="/connect/" className="mk-btn mk-btn-secondary">
            Connect
          </Link>
        </div>

        <button
          type="button"
          className="mk-nav-mobile-btn mk-btn mk-btn-secondary ml-auto px-3"
          aria-expanded={open}
          aria-controls="mk-mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          <span className="sr-only">Menu</span>
        </button>
      </nav>

      {open ? (
        <div
          id="mk-mobile-menu"
          className="mk-nav-mobile-panel mt-2 rounded-[14px] border border-[var(--mk-line)] bg-[rgba(10,18,32,0.95)] p-3 backdrop-blur"
        >
          <div className="flex flex-col gap-1">
            {LINKS.map((l) =>
              l.external ? (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mk-nav-link"
                  onClick={() => setOpen(false)}
                >
                  {l.label} ↗
                </a>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  className="mk-nav-link"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              ),
            )}
            <Link href="/overview/" className="mk-btn mk-btn-primary mt-2 w-full" onClick={() => setOpen(false)}>
              Open Studio
            </Link>
            <Link href="/connect/" className="mk-btn mk-btn-secondary w-full" onClick={() => setOpen(false)}>
              Connect
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
