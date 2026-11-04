"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, LoadingBlock } from "@/components/state-block";
import { OnboardingEmpty } from "@/components/studio/onboarding-empty";
import { SampleChip } from "@/components/studio/sample-chip";
import { ErrorState, PageHeader } from "@/components/studio/page-chrome";
import { OutcomeChip, StatusDot } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { isSampleTagged } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { listTraces } from "@/lib/api";
import { sourceChipClass, fmtMs } from "@/lib/trace-helpers";
import {
  filterSortRows,
  filtersFromSearchParams,
  filtersToSearchParams,
  listRowFromApi,
  listRowFromSuite,
  type DateRangePreset,
  type TraceListFilters,
  type TraceListRow,
} from "@/lib/trace-model";

function TracesInner() {
  const { mode } = useApiMode();
  const suiteCtx = useSuite();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => filtersFromSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [rows, setRows] = useState<TraceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverThumb, setHoverThumb] = useState<{ url: string; x: number; y: number } | null>(
    null,
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const setFilters = useCallback(
    (patch: Partial<TraceListFilters>) => {
      const next = { ...filters, ...patch };
      if (
        patch.q !== undefined ||
        patch.outcome !== undefined ||
        patch.model !== undefined ||
        patch.modality !== undefined ||
        patch.source !== undefined ||
        patch.from !== undefined ||
        patch.to !== undefined ||
        patch.range !== undefined ||
        patch.hasTools !== undefined ||
        patch.needsReview !== undefined
      ) {
        next.page = 1;
      }
      const qs = filtersToSearchParams(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "live") {
        const items = await listTraces({
          limit: 200,
          q: filters.q || undefined,
          source: filters.source !== "all" ? filters.source : undefined,
          agent: filters.model !== "all" ? filters.model : undefined,
        });
        setRows(items.map(listRowFromApi));
      } else {
        const data = suiteCtx.data;
        const suite = suiteCtx.suite;
        setRows((data.traces || []).map((t) => listRowFromSuite(t, data, suite)));
      }
    } catch {
      setError("Couldn’t load traces. Try again.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [mode, filters.q, filters.source, filters.model, suiteCtx.data, suiteCtx.suite]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!filters.live || mode !== "live") return;
    const id = window.setInterval(() => {
      load();
    }, 3000);
    return () => window.clearInterval(id);
  }, [filters.live, mode, load]);

  const filtered = useMemo(() => filterSortRows(rows, filters), [rows, filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const pageRows = filtered.slice((page - 1) * filters.pageSize, page * filters.pageSize);

  useEffect(() => {
    setFocusIdx(0);
  }, [page, filters.q, filters.outcome, filters.model, filters.modality]);

  const outcomes = useMemo(
    () =>
      [...new Set(rows.map((r) => r.outcome).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const models = useMemo(
    () => [...new Set(rows.map((r) => r.model).filter((m) => m && m !== "—"))].sort(),
    [rows],
  );
  const sources = useMemo(
    () => [...new Set(rows.map((r) => r.source).filter(Boolean))].sort(),
    [rows],
  );

  const openRow = useCallback(
    (row: TraceListRow) => {
      const suiteQ = row.suite ? `&suite=${encodeURIComponent(row.suite)}` : "";
      router.push(`/traces/view/?id=${encodeURIComponent(row.id)}${suiteQ}`);
    },
    [router],
  );

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pageRows.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(pageRows.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        openRow(pageRows[focusIdx]);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [pageRows, focusIdx, openRow]);

  const toggleSort = (key: string) => {
    if (filters.sort === key) {
      setFilters({ dir: filters.dir === "asc" ? "desc" : "asc" });
    } else {
      setFilters({ sort: key, dir: key === "name" || key === "title" ? "asc" : "desc" });
    }
  };

  const sortMark = (key: string) =>
    filters.sort === key ? (filters.dir === "asc" ? " ↑" : " ↓") : "";

  const columns: ColumnDef<TraceListRow>[] = useMemo(
    () => [
      {
        id: "time",
        header: `Time${sortMark("time")}`,
        cell: (r) => (
          <button type="button" className="text-left tabular-nums" onClick={() => toggleSort("time")}>
            {r.time ? new Date(r.time).toLocaleString() : "—"}
          </button>
        ),
        className: "whitespace-nowrap",
      },
      {
        id: "name",
        header: `Name${sortMark("name")}`,
        cell: (r) => (
          <span className="font-medium text-ink" title={r.id}>
            {r.title}
          </span>
        ),
        className: "max-w-[220px]",
      },
      {
        id: "input",
        header: "Input",
        cell: (r) => <span className="block max-w-[180px] truncate text-ink/70">{r.inputPreview}</span>,
      },
      {
        id: "output",
        header: "Output",
        cell: (r) => <span className="block max-w-[140px] truncate text-ink/70">{r.outputPreview}</span>,
      },
      {
        id: "outcome",
        header: `Outcome${sortMark("outcome")}`,
        cell: (r) => <OutcomeChip label={r.outcome} />,
      },
      {
        id: "model",
        header: `Model${sortMark("model")}`,
        cell: (r) => r.model,
      },
      {
        id: "latency",
        header: `Latency${sortMark("latency")}`,
        cell: (r) => <span className="tabular-nums">{fmtMs(r.latencyMs)}</span>,
      },
      {
        id: "tokens",
        header: `Tokens${sortMark("tokens")}`,
        cell: (r) => <span className="tabular-nums">{r.tokens != null ? r.tokens : "—"}</span>,
      },
      {
        id: "tools",
        header: `Tool calls${sortMark("tools")}`,
        cell: (r) => <span className="tabular-nums">{r.toolCalls}</span>,
      },
      {
        id: "evals",
        header: "Evaluations",
        cell: (r) =>
          r.evalDots.length ? (
            <div className="flex flex-wrap gap-1">
              {r.evalDots.slice(0, 8).map((d, i) => (
                <StatusDot key={`${d.dimension}-${i}`} verdict={d.verdict} label={d.dimension} />
              ))}
            </div>
          ) : (
            <span className="text-ink/35">—</span>
          ),
      },
      {
        id: "tags",
        header: "Tags",
        cell: (r) => {
          const sample = isSampleTagged(r.tags);
          const rest = r.tags.filter((t) => t.toLowerCase() !== "sample").slice(0, sample ? 3 : 4);
          return (
            <div className="flex max-w-[160px] flex-wrap gap-1">
              {sample ? <SampleChip /> : null}
              {rest.map((t) => (
                <Badge key={t} className="border-border bg-muted text-[10px] text-ink/60">
                  {t}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: "source",
        header: "Source",
        cell: (r) => <Badge className={sourceChipClass(r.source)}>{r.source}</Badge>,
        defaultVisible: false,
      },
      {
        id: "modality",
        header: "Modality",
        cell: (r) => r.modality,
        defaultVisible: false,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.sort, filters.dir],
  );

  const liveEmpty = mode === "live" && !loading && !error && rows.length === 0;
  const showTable = !error && !liveEmpty;

  return (
    <>
      <Topbar hideTitle />
      <main className="min-w-0 space-y-3 overflow-x-hidden p-4">
        <PageHeader
          title="Traces"
          description="Inspect multimodal runs with evidence, tools and evaluations."
        />

        {liveEmpty ? <OnboardingEmpty onSeeded={load} /> : null}

        {error ? (
          <ErrorState title="Couldn't load traces" detail={error} onRetry={load} />
        ) : null}

        {showTable ? (
          <>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <Filter label="Search">
            <Input
              className="w-44"
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search…"
              aria-label="Search traces"
            />
          </Filter>
          <Filter label="Outcome">
            <Select value={filters.outcome} onValueChange={(v) => setFilters({ outcome: v })}>
              <SelectTrigger className="w-40" aria-label="Outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {outcomes.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Model">
            <Select value={filters.model} onValueChange={(v) => setFilters({ model: v })}>
              <SelectTrigger className="w-36" aria-label="Model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Modality">
            <Select value={filters.modality} onValueChange={(v) => setFilters({ modality: v })}>
              <SelectTrigger className="w-36" aria-label="Modality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {["image", "video", "voice", "text", "cross-modal"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Source">
            <Select value={filters.source} onValueChange={(v) => setFilters({ source: v })}>
              <SelectTrigger className="w-32" aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="When">
            <SegmentedControl
              aria-label="Date range"
              value={filters.range}
              onChange={(v) => setFilters({ range: v as DateRangePreset })}
              options={[
                { value: "all", label: "All" },
                { value: "24h", label: "Last 24 h" },
                { value: "7d", label: "7 d" },
                { value: "30d", label: "30 d" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </Filter>
          {filters.range === "custom" ? (
            <>
              <Filter label="From">
                <Input
                  type="date"
                  className="w-36"
                  value={filters.from.slice(0, 10)}
                  onChange={(e) => setFilters({ from: e.target.value })}
                />
              </Filter>
              <Filter label="To">
                <Input
                  type="date"
                  className="w-36"
                  value={filters.to.slice(0, 10)}
                  onChange={(e) => setFilters({ to: e.target.value })}
                />
              </Filter>
            </>
          ) : null}
          <label className="flex items-center gap-2 pb-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={filters.hasTools}
              onChange={(e) => setFilters({ hasTools: e.target.checked })}
            />
            Has tool calls
          </label>
          <label className="flex items-center gap-2 pb-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={filters.needsReview}
              onChange={(e) => setFilters({ needsReview: e.target.checked })}
            />
            Needs review
          </label>
          <div className="ml-auto flex items-center gap-2 pb-1">
            <span className="text-xs text-ink-muted">Live</span>
            <Switch
              checked={filters.live}
              onCheckedChange={(v) => setFilters({ live: v })}
              disabled={mode !== "live"}
              aria-label="Live polling"
            />
            {filters.live && mode === "live" ? (
              <span className="text-[10px] text-teal">polling 3s</span>
            ) : null}
          </div>
        </div>

        {loading && !rows.length ? <LoadingBlock /> : null}

        <div
          ref={tableRef}
          tabIndex={0}
          className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            minWidth={1100}
            onRowClick={openRow}
            empty={
              loading ? null : <EmptyBlock title="No traces match these filters." />
            }
          />
          {/* Hover thumb + keyboard focus highlight via overlay rows isn't in DataTable —
              wrap interaction with a secondary absolute preview. */}
          <div className="mt-[-1px] border-t border-hairline bg-surface px-2 py-1 text-[11px] text-ink-muted">
            Focus row with ↑↓, Enter to open
            {pageRows[focusIdx] ? (
              <>
                {" · "}
                <Link
                  href={`/traces/view/?id=${encodeURIComponent(pageRows[focusIdx].id)}${
                    pageRows[focusIdx].suite
                      ? `&suite=${encodeURIComponent(pageRows[focusIdx].suite)}`
                      : ""
                  }`}
                  className="font-medium text-accent hover:underline"
                  onMouseEnter={(e) => {
                    const url = pageRows[focusIdx].thumbUrl;
                    if (!url) return;
                    setHoverThumb({ url, x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => setHoverThumb(null)}
                >
                  {pageRows[focusIdx].title}
                </Link>
              </>
            ) : null}
          </div>
        </div>

        {/* Row hover thumbs: listen on table body via event delegation */}
        <RowHoverBridge
          rows={pageRows}
          onHover={setHoverThumb}
          focusIdx={focusIdx}
          onFocusIdx={setFocusIdx}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/55">
          <span>
            {filtered.length} traces · page {page} / {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setFilters({ page: page - 1 })}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => setFilters({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>

        {hoverThumb ? (
          <div
            className="pointer-events-none fixed z-50 overflow-hidden rounded border border-border bg-raised shadow-lg"
            style={{ left: hoverThumb.x + 16, top: hoverThumb.y + 16, width: 160 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hoverThumb.url} alt="" className="h-28 w-full object-cover" />
          </div>
        ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}

/** Attach mouseenter handlers after DataTable paints by querying rows via data attributes is hard —
 * instead patch clickable rows' hover using a MutationObserver-free approach: duplicate lightweight
 * hover targets aren't ideal. We enhance DataTable rows by rendering an invisible overlay list. */
function RowHoverBridge({
  rows,
  onHover,
  focusIdx,
  onFocusIdx,
}: {
  rows: TraceListRow[];
  onHover: (v: { url: string; x: number; y: number } | null) => void;
  focusIdx: number;
  onFocusIdx: (i: number) => void;
}) {
  // Visual focus ring is applied by injecting a class via effect on table rows order.
  useEffect(() => {
    const tables = document.querySelectorAll(".sticky-table tbody tr");
    tables.forEach((tr, i) => {
      const el = tr as HTMLElement;
      el.classList.toggle("bg-teal/5", i === focusIdx);
      el.onmouseenter = (e: MouseEvent) => {
        onFocusIdx(i);
        const url = rows[i]?.thumbUrl;
        if (!url) {
          onHover(null);
          return;
        }
        onHover({ url, x: e.clientX, y: e.clientY });
      };
      el.onmousemove = (e: MouseEvent) => {
        const url = rows[i]?.thumbUrl;
        if (!url) return;
        onHover({ url, x: e.clientX, y: e.clientY });
      };
      el.onmouseleave = () => onHover(null);
    });
    return () => {
      tables.forEach((tr) => {
        const el = tr as HTMLElement;
        el.onmouseenter = null;
        el.onmousemove = null;
        el.onmouseleave = null;
      });
    };
  }, [rows, focusIdx, onHover, onFocusIdx]);
  return null;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink/45">{label}</div>
      {children}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading traces…" />}>
      <TracesInner />
    </Suspense>
  );
}
