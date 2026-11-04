"use client";

import { useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSuite } from "@/context/suite-context";
import { caseTags } from "@/lib/metrics";
import type { CaseRow } from "@/lib/types";

export default function DatasetsPage() {
  const { data, loading, error } = useSuite();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CaseRow | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.cases || []).filter((c) => {
      if (!needle) return true;
      return (
        c.id.toLowerCase().includes(needle) ||
        (c.family || "").toLowerCase().includes(needle) ||
        (c.question || "").toLowerCase().includes(needle) ||
        (c.answer || "").toLowerCase().includes(needle)
      );
    });
  }, [data.cases, q]);

  return (
    <>
      <Topbar title="Datasets" />
      <main className="space-y-3 p-4">
        <div className="max-w-sm">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter cases…"
            aria-label="Filter cases"
          />
        </div>

        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}

        {!loading && !error ? (
          <div className="overflow-auto rounded-lg border border-border bg-white">
            <table className="sticky-table w-full min-w-[800px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-ink/60">
                  <th className="px-3 py-2">Thumb</th>
                  <th className="px-3 py-2">Case</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-ink/50">
                      No cases.
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => {
                    const tags = caseTags(c.tags);
                    return (
                      <tr
                        key={c.id}
                        className="cursor-pointer border-t border-border hover:bg-muted/60"
                        onClick={() => setSelected(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelected(c);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td className="px-3 py-1.5">
                          {c.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.image}
                              alt=""
                              className="h-10 w-10 rounded border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-border text-[10px] text-ink/40">
                              {c.modality === "audio" || c.audio ? "AUD" : "—"}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-medium">{c.id}</td>
                        <td className="px-3 py-1.5">{c.family || "—"}</td>
                        <td className="max-w-md truncate px-3 py-1.5 text-ink/80">{c.question || "—"}</td>
                        <td className="px-3 py-1.5 font-medium">{c.answer || "—"}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {tags.length
                              ? tags.map((t) => (
                                  <Badge key={t} className="border-border bg-muted text-ink/70">
                                    {t}
                                  </Badge>
                                ))
                              : "—"}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent title={selected?.id || "Case"}>
            {selected ? (
              <div className="space-y-3 text-sm">
                {selected.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.image}
                    alt={selected.id}
                    className="max-h-64 w-full rounded border border-border object-contain"
                  />
                ) : null}
                {selected.audio ? <audio controls src={selected.audio} className="w-full" /> : null}
                <Field label="Family" value={selected.family} />
                <Field label="Question" value={selected.question} />
                <Field label="Expected answer" value={selected.answer} />
                <Field label="Distractor" value={selected.distractor} />
                <Field
                  label="Truth box"
                  value={selected.truth_box ? JSON.stringify(selected.truth_box) : undefined}
                />
                <Field
                  label="Truth span"
                  value={selected.truth_span ? JSON.stringify(selected.truth_span) : undefined}
                />
                <Field label="Tags" value={caseTags(selected.tags).join(", ") || undefined} />
                {selected.turns?.length ? (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-ink/45">Turns</div>
                    <pre className="mono mt-1 max-h-48 overflow-auto rounded border border-border bg-paper p-2 text-[11px]">
                      {JSON.stringify(selected.turns, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-sm text-ink">{value || "—"}</div>
    </div>
  );
}
