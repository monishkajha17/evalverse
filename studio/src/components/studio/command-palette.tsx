"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PAGES: Array<{ label: string; href: string; keywords?: string }> = [
  { label: "Home / Overview", href: "/overview/", keywords: "home overview" },
  { label: "Traces", href: "/traces/", keywords: "traces list" },
  { label: "Sessions", href: "/sessions/", keywords: "sessions" },
  { label: "Playground", href: "/playground/", keywords: "playground sample" },
  { label: "Evaluators", href: "/evaluators/", keywords: "evaluators judge" },
  { label: "Online evaluation", href: "/online-evaluation/", keywords: "policies alerts" },
  { label: "Human review", href: "/human-review/", keywords: "review" },
  { label: "Runs", href: "/runs/", keywords: "runs evaluations" },
  { label: "Datasets", href: "/datasets/", keywords: "datasets" },
  { label: "Experiments", href: "/experiments/", keywords: "experiments" },
  { label: "Settings", href: "/settings/", keywords: "settings keys" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PAGES;
    const pageHits = PAGES.filter(
      (p) =>
        p.label.toLowerCase().includes(needle) ||
        (p.keywords || "").includes(needle) ||
        p.href.includes(needle),
    );
    const looksLikeTrace =
      needle.includes("|") || /^[a-f0-9-]{8,}$/i.test(needle) || needle.startsWith("muse-");
    if (looksLikeTrace) {
      return [
        {
          label: `Open trace “${q.trim()}”`,
          href: `/traces/view/?id=${encodeURIComponent(q.trim())}`,
        },
        ...pageHits,
      ];
    }
    return pageHits;
  }, [q]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="border-b border-hairline p-2">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page or paste a trace id…"
            aria-label="Command search"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <ul className="max-h-72 overflow-auto p-1" role="listbox">
          {results.map((r, i) => (
            <li key={r.href + r.label}>
              <button
                type="button"
                role="option"
                aria-selected={i === 0}
                className="flex w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-muted"
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  router.push(r.href);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
          {!results.length ? (
            <li className="px-3 py-6 text-center text-xs text-ink-muted">No matches</li>
          ) : null}
        </ul>
        <div className="border-t border-hairline px-3 py-1.5 text-[11px] text-ink-subtle">
          ⌘/Ctrl K · Enter to open
        </div>
      </DialogContent>
    </Dialog>
  );
}
