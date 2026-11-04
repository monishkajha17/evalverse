"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchItem } from "@/components/docs/content";

function isModK(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
}

export function DocSearch({ index }: { index: SearchItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 1) return [];
    return index
      .filter((item) => {
        const hay = `${item.title} ${item.heading || ""} ${item.excerpt || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 12);
  }, [q, index]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !open) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        setOpen(true);
      }
      if (isModK(e)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  function hrefFor(r: SearchItem) {
    return r.headingId ? `/docs/${r.slug}/#${r.headingId}` : `/docs/${r.slug}/`;
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      window.location.href = hrefFor(results[active]);
      close();
    }
  }

  return (
    <div className="docs-search">
      <button type="button" className="docs-search-trigger" onClick={() => setOpen(true)}>
        <span>Search docs…</span>
        <kbd className="docs-kbd">/</kbd>
      </button>

      {open ? (
        <div className="docs-search-overlay" role="dialog" aria-modal="true" aria-label="Search docs">
          <button type="button" className="docs-search-backdrop" aria-label="Close search" onClick={close} />
          <div className="docs-search-modal">
            <div className="docs-search-modal-bar">
              <input
                ref={inputRef}
                type="search"
                placeholder="Search titles, headings, and first paragraphs…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="docs-search-list"
              />
              <kbd className="docs-kbd">esc</kbd>
            </div>
            <div id="docs-search-list" className="docs-search-results" role="listbox">
              {!q.trim() ? (
                <p className="docs-search-hint">Type to search. Use ↑ ↓ and Enter.</p>
              ) : results.length === 0 ? (
                <p className="docs-search-hint">No matches.</p>
              ) : (
                results.map((r, i) => (
                  <Link
                    key={`${r.slug}-${r.headingId || "t"}-${i}`}
                    href={hrefFor(r)}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "is-active" : undefined}
                    onClick={close}
                    onMouseEnter={() => setActive(i)}
                  >
                    <div className="text-[var(--mk-text)]">{r.heading || r.title}</div>
                    <div className="text-[10px] text-[var(--mk-muted)]">
                      {r.heading ? r.title : r.excerpt || r.slug}
                    </div>
                  </Link>
                ))
              )}
            </div>
            <div className="docs-search-footer">
              <span>
                <kbd className="docs-kbd">⌘</kbd>
                <kbd className="docs-kbd">K</kbd> or <kbd className="docs-kbd">/</kbd>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
