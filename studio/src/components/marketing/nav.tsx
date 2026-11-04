"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

const PRODUCT_ITEMS = [
  { href: "/#shift", label: "The shift" },
  { href: "/#observe", label: "Observability" },
  { href: "/#evaluate", label: "Evaluation" },
  { href: "/try/", label: "Try it" },
  { href: "/#monitor", label: "Offline and online" },
  { href: "/#trust", label: "Judges and review" },
  { href: "/#score", label: "Score" },
];

const CENTRE = [
  { href: "/#observe", label: "Observability" },
  { href: "/#evaluate", label: "Evals" },
  { href: "/docs/", label: "Docs" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setProductOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="mk-nav-shell">
      <nav className="mk-nav mx-auto max-w-[1200px]" aria-label="Marketing">
        <Link href="/" className="pr-3 text-sm font-medium tracking-tight text-[var(--mk-text)]">
          EvalVerse
        </Link>

        <div className="mk-nav-desktop relative ml-1 flex flex-1 items-center gap-0.5" ref={menuRef}>
          <div className="relative">
            <button
              type="button"
              className="mk-nav-link"
              aria-expanded={productOpen}
              aria-haspopup="true"
              onClick={() => setProductOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setProductOpen(false);
              }}
            >
              Product
              <span className="ml-1 opacity-60" aria-hidden>
                ▾
              </span>
            </button>
            {productOpen ? (
              <div className="mk-nav-menu" role="menu">
                {PRODUCT_ITEMS.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setProductOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          {CENTRE.map((l) => (
            <Link key={l.href + l.label} href={l.href} className="mk-nav-link">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="mk-nav-desktop ml-auto flex items-center gap-3">
          <Link href="/signin/" className="mk-btn mk-btn-ghost">
            Sign in
          </Link>
          <Link href="/signup/" className="mk-btn mk-btn-primary">
            Start building
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
          className="mk-nav-mobile-panel border-b border-[var(--mk-line)] bg-[rgba(5,10,20,0.96)] px-4 py-3 backdrop-blur"
        >
          <div className="mx-auto flex max-w-[1200px] flex-col gap-1">
            <p className="mk-label mb-1 px-2">Product</p>
            {PRODUCT_ITEMS.map((item) => (
              <Link key={item.label} href={item.href} className="mk-nav-link" onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ))}
            {CENTRE.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="mk-nav-link" onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            <Link href="/signin/" className="mk-btn mk-btn-ghost mt-2 justify-start" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link href="/signup/" className="mk-btn mk-btn-primary w-full" onClick={() => setOpen(false)}>
              Start building
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
