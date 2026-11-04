"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  createDataset,
  exportDataset,
  getDataset,
  importDataset,
  listDatasetItems,
  listDatasets,
  mediaFileUrl,
  type Dataset,
  type DatasetDetail,
  type DatasetItem,
} from "@/lib/api";
import { caseTags } from "@/lib/metrics";
import type { CaseRow } from "@/lib/types";
import { posterFrameSrc, videoSrc } from "@/lib/video";

type DatasetRow = {
  id: string;
  name: string;
  items: number;
  versions: number;
  modality: string;
  created: string;
};

type ItemRow = {
  id: string;
  thumb: string | null;
  question: string;
  expectation: string;
  tags: string[];
  raw: DatasetItem | CaseRow;
  kind: "live" | "demo";
};

export default function DatasetsPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveDatasets />;
  return <DemoDatasets />;
}

function VideoPoster({ caseRow }: { caseRow: CaseRow }) {
  const [ok, setOk] = useState(true);
  const src = posterFrameSrc(caseRow);
  if (!src || !ok) {
    return (
      <div className="mb-2 flex h-28 items-center justify-center rounded border border-dashed text-ink/40">
        No poster frame
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="mb-2 h-28 w-full rounded border object-cover"
      onError={() => setOk(false)}
    />
  );
}

function LiveDatasets() {
  const { signedIn } = useApiMode();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [details, setDetails] = useState<Record<string, DatasetDetail>>({});
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [item, setItem] = useState<DatasetItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const ds = await listDatasets();
      setDatasets(ds);
      const detailMap: Record<string, DatasetDetail> = {};
      const counts: Record<string, number> = {};
      for (const d of ds.slice(0, 40)) {
        try {
          const full = await getDataset(d.id);
          detailMap[d.id] = full;
          const versionId = full.versions?.[full.versions.length - 1]?.id;
          const its = await listDatasetItems(d.id, versionId);
          counts[d.id] = its.length;
        } catch {
          counts[d.id] = 0;
        }
      }
      setDetails(detailMap);
      setItemCounts(counts);
      const sid = selectedId || ds[0]?.id || "";
      setSelectedId(sid);
      if (sid) {
        const d = detailMap[sid] || (await getDataset(sid));
        setDetail(d);
        const versionId = d.versions?.[d.versions.length - 1]?.id;
        setItems(await listDatasetItems(sid, versionId));
      } else {
        setDetail(null);
        setItems([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load datasets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const d = details[selectedId] || (await getDataset(selectedId));
        setDetail(d);
        const versionId = d.versions?.[d.versions.length - 1]?.id;
        setItems(await listDatasetItems(selectedId, versionId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load dataset");
      }
    })();
  }, [selectedId, details]);

  const datasetRows: DatasetRow[] = datasets.map((d) => {
    const full = details[d.id];
    const modality =
      (full?.metadata?.modality as string) ||
      (d.metadata?.modality as string) ||
      "—";
    return {
      id: d.id,
      name: d.name,
      items: itemCounts[d.id] ?? 0,
      versions: full?.versions?.length ?? 0,
      modality: String(modality),
      created: d.created_at ? new Date(d.created_at).toLocaleDateString() : "—",
    };
  });

  const itemRows: ItemRow[] = items.map((it) => {
    const media = it.media?.[0];
    const src = media ? mediaFileUrl(media.url || media.id) : null;
    const question =
      typeof it.input === "string"
        ? it.input
        : it.input && typeof it.input === "object" && "question" in (it.input as object)
          ? String((it.input as { question?: unknown }).question ?? "")
          : JSON.stringify(it.input ?? "");
    return {
      id: it.id,
      thumb: src,
      question: question || "—",
      expectation: JSON.stringify(it.expectation || {}),
      tags: it.tags || [],
      raw: it,
      kind: "live",
    };
  });

  const filteredItems = itemRows.filter((r) => {
    const hay = `${r.question} ${r.expectation} ${r.tags.join(" ")}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });

  const datasetColumns: ColumnDef<DatasetRow>[] = [
    { id: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "items", header: "Items", cell: (r) => <span className="tabular-nums">{r.items}</span> },
    { id: "versions", header: "Versions", cell: (r) => <span className="tabular-nums">{r.versions}</span> },
    { id: "modality", header: "Modality", cell: (r) => r.modality },
    { id: "created", header: "Created", cell: (r) => r.created },
  ];

  const itemColumns: ColumnDef<ItemRow>[] = [
    {
      id: "thumb",
      header: "Thumb",
      cell: (r) =>
        r.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.thumb} alt="" className="h-10 w-10 rounded border object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed text-[10px] text-ink/40">
            —
          </div>
        ),
    },
    {
      id: "question",
      header: "Question",
      cell: (r) => <span className="line-clamp-2 max-w-md">{r.question}</span>,
    },
    {
      id: "expectation",
      header: "Expectation",
      cell: (r) => <span className="line-clamp-2 max-w-sm text-ink/70">{r.expectation}</span>,
    },
  ];

  return (
    <>
      <Topbar title="Datasets" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Datasets"
          description="Versioned collections of cases with expectations."
          action={
            <>
              <label className="cursor-pointer">
                <span className="inline-flex h-8 items-center rounded-md border border-border bg-white px-3 text-xs hover:bg-muted">
                  Import
                </span>
                <input
                  type="file"
                  accept=".json,.jsonl,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !selectedId) {
                      setMsg("Select a dataset first, then import.");
                      return;
                    }
                    const text = await file.text();
                    let body: unknown = text;
                    try {
                      body = JSON.parse(text);
                    } catch {
                      body = text
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => JSON.parse(line));
                    }
                    await importDataset(selectedId, body);
                    setMsg("Imported items.");
                    void reload();
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedId}
                onClick={async () => {
                  const versionId = detail?.versions?.[detail.versions.length - 1]?.id;
                  const data = await exportDataset(selectedId, versionId);
                  const blob = new Blob(
                    [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
                    { type: "application/json" },
                  );
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${detail?.name || "dataset"}.jsonl`;
                  a.click();
                  setMsg("Exported.");
                }}
              >
                Export
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href="/traces/">Add items from traces</Link>
              </Button>
            </>
          }
        />

        {msg ? <p className="text-xs text-ink/55">{msg}</p> : null}

        <FilterBar>
          <Input
            className="h-8 w-44"
            placeholder="New dataset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                const d = await createDataset({ name: name.trim() });
                setMsg(`Created ${d.name}`);
                setName("");
                setSelectedId(d.id);
                void reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not create dataset");
              }
            }}
          >
            Create
          </Button>
          {!signedIn ? (
            <span className="text-xs text-ink/45">Sign in to save changes across devices.</span>
          ) : null}
        </FilterBar>

        {loading ? <SkeletonBlock /> : null}
        {error ? <ErrorState detail={error} onRetry={() => void reload()} /> : null}

        {!loading ? (
          <DataTable
            columns={datasetColumns}
            rows={datasetRows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelectedId(r.id)}
            empty={
              <EmptyState
                title="No datasets yet"
                detail="Create a dataset, then import cases or promote them from traces."
              />
            }
          />
        ) : null}

        {selectedId ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                Items · {detail?.name || selectedId}
              </h3>
              <Input
                className="h-8 max-w-xs"
                placeholder="Filter items"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <DataTable
              columns={itemColumns}
              rows={filteredItems}
              rowKey={(r) => r.id}
              onRowClick={(r) => setItem(r.raw as DatasetItem)}
              empty={<EmptyState title="No items in this version" />}
            />
          </div>
        ) : null}

        <Sheet open={!!item} onOpenChange={(o) => !o && setItem(null)}>
          <SheetContent title={item?.id || "Item"}>
            {item ? (
              <pre className="overflow-auto text-[11px] leading-relaxed">
                {JSON.stringify(item, null, 2)}
              </pre>
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </>
  );
}

function DemoDatasets() {
  const { data, loading, error, entry } = useSuite();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CaseRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const modality = entry?.modality || data.meta.modality || "—";
  const created = data.meta.created
    ? new Date(data.meta.created).toLocaleDateString()
    : "—";

  const datasetRows: DatasetRow[] = [
    {
      id: entry?.suite || "demo",
      name: entry?.suite || "Demo suite",
      items: (data.cases || []).length,
      versions: 1,
      modality: String(modality),
      created,
    },
  ];

  const itemRows: ItemRow[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.cases || [])
      .filter(
        (c) =>
          !needle ||
          c.id.toLowerCase().includes(needle) ||
          (c.question || "").toLowerCase().includes(needle),
      )
      .map((c) => {
        const isVideo = c.modality === "video" || !!c.video;
        const thumb = isVideo ? posterFrameSrc(c) : c.image || null;
        return {
          id: c.id,
          thumb,
          question: c.question || c.id,
          expectation: c.answer || c.expected_verdict || "—",
          tags: caseTags(c.tags),
          raw: c,
          kind: "demo" as const,
        };
      });
  }, [data.cases, q]);

  const datasetColumns: ColumnDef<DatasetRow>[] = [
    { id: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "items", header: "Items", cell: (r) => <span className="tabular-nums">{r.items}</span> },
    { id: "versions", header: "Versions", cell: (r) => <span className="tabular-nums">{r.versions}</span> },
    { id: "modality", header: "Modality", cell: (r) => r.modality },
    { id: "created", header: "Created", cell: (r) => r.created },
  ];

  const itemColumns: ColumnDef<ItemRow>[] = [
    {
      id: "thumb",
      header: "Thumb",
      cell: (r) =>
        r.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.thumb}
            alt=""
            className="h-10 w-10 rounded border object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed text-[10px] text-ink/40">
            —
          </div>
        ),
    },
    {
      id: "question",
      header: "Question",
      cell: (r) => <span className="line-clamp-2 max-w-md">{r.question}</span>,
    },
    {
      id: "expectation",
      header: "Expectation",
      cell: (r) => <span className="line-clamp-2 max-w-sm">{r.expectation}</span>,
    },
    {
      id: "tags",
      header: "Tags",
      cell: (r) =>
        r.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {r.tags.slice(0, 4).map((t) => (
              <Badge key={t} className="border-border bg-muted">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          "—"
        ),
      defaultVisible: false,
    },
  ];

  return (
    <>
      <Topbar title="Datasets" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Datasets"
          description="Versioned collections of cases with expectations."
          action={
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMsg("Sign in to import datasets.")}
              >
                Import
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(data.cases || [], null, 2)], {
                    type: "application/json",
                  });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${entry?.suite || "dataset"}.json`;
                  a.click();
                  setMsg("Downloaded demo cases.");
                }}
              >
                Export
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMsg("Sign in to add items from traces.")}
              >
                Add items from traces
              </Button>
            </>
          }
        />

        {msg ? <p className="text-xs text-ink/55">{msg}</p> : null}

        <FilterBar>
          <Input
            className="h-8 max-w-xs"
            placeholder="Filter items"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </FilterBar>

        {loading ? <SkeletonBlock /> : null}
        {error ? <ErrorState detail={error} /> : null}

        {!loading ? (
          <>
            <DataTable
              columns={datasetColumns}
              rows={datasetRows}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No datasets in this suite" />}
            />
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Items</h3>
              <DataTable
                columns={itemColumns}
                rows={itemRows}
                rowKey={(r) => r.id}
                onRowClick={(r) => setSelected(r.raw as CaseRow)}
                empty={<EmptyState title="No cases in this suite" />}
              />
            </div>
          </>
        ) : null}

        <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent title={selected?.id || "Case"}>
            {selected ? (
              <div className="space-y-3 text-xs">
                {(selected.modality === "video" || selected.video) && (
                  <>
                    <VideoPoster caseRow={selected} />
                    {videoSrc(selected) ? (
                      <video controls className="mb-2 w-full rounded border" src={videoSrc(selected)} />
                    ) : null}
                  </>
                )}
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-ink/45">Question</dt>
                    <dd>{selected.question || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Expectation</dt>
                    <dd>{selected.answer || selected.expected_verdict || "—"}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </>
  );
}
