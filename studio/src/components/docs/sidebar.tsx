"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import type { DocMeta, SearchItem } from "@/components/docs/content";
import { DocSearch } from "@/components/docs/search";

function NavTree({
  tree,
  activeSlug,
  onNavigate,
}: {
  tree: Array<{ group: string; items: DocMeta[] }>;
  activeSlug: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of tree) init[g.group] = true;
    return init;
  });

  return (
    <>
      {tree.map((g) => (
        <div key={g.group} className="mb-2">
          <button
            type="button"
            className="docs-group-btn"
            aria-expanded={open[g.group] !== false}
            onClick={() => setOpen((s) => ({ ...s, [g.group]: !(s[g.group] !== false) }))}
          >
            <span>{g.group}</span>
            <span aria-hidden>{open[g.group] !== false ? "−" : "+"}</span>
          </button>
          {open[g.group] !== false ? (
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const href = `/docs/${item.slug}/`;
                const active = activeSlug === item.slug;
                return (
                  <Link
                    key={item.slug}
                    href={href}
                    className={`docs-nav-link${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    {item.title}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function DocSidebar({
  tree,
  searchIndex,
}: {
  tree: Array<{ group: string; items: DocMeta[] }>;
  searchIndex: SearchItem[];
}) {
  const pathname = usePathname();
  const activeSlug = useMemo(() => {
    const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0] === "docs") return parts.slice(1).join("/") || "overview";
    return "overview";
  }, [pathname]);

  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawer) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawer(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <>
      <div className="docs-mobile-bar">
        <button
          type="button"
          className="mk-btn mk-btn-secondary min-h-[40px] px-3"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
        >
          <Menu className="h-4 w-4" />
          Menu
        </button>
        <DocSearch index={searchIndex} />
      </div>

      <aside className="docs-sidebar docs-sidebar-desktop" aria-label="Documentation">
        <DocSearch index={searchIndex} />
        <NavTree tree={tree} activeSlug={activeSlug} />
      </aside>

      {drawer ? (
        <div className="docs-drawer" role="dialog" aria-modal="true" aria-label="Docs menu">
          <button
            type="button"
            className="docs-drawer-backdrop"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          />
          <div className="docs-drawer-panel">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="mk-label">Docs</span>
              <button
                type="button"
                className="mk-btn mk-btn-ghost min-h-[36px] px-2"
                onClick={() => setDrawer(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <NavTree tree={tree} activeSlug={activeSlug} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
