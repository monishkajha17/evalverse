"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
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

export default function DatasetsPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveDatasets />;
  return <SnapshotDatasets />;
}

function LiveDatasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [item, setItem] = useState<DatasetItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const ds = await listDatasets();
      setDatasets(ds);
      const sid = selectedId || ds[0]?.id || "";
      setSelectedId(sid);
      if (sid) {
        const d = await getDataset(sid);
        setDetail(d);
        const versionId = d.versions?.[d.versions.length - 1]?.id;
        setItems(await listDatasetItems(sid, versionId));
      } else {
        setDetail(null);
        setItems([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const d = await getDataset(selectedId);
        setDetail(d);
        const versionId = d.versions?.[d.versions.length - 1]?.id;
        setItems(await listDatasetItems(selectedId, versionId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, [selectedId]);

  return (
    <>
      <Topbar title="Datasets" />
      <main className="space-y-3 p-4">
        {msg ? <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{msg}</div> : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <div className="mb-1 text-[11px] uppercase text-ink/45">Dataset</div>
            <select
              className="h-8 w-full rounded border border-border px-2 text-xs"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            className="w-40"
            placeholder="New dataset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!name}
            onClick={async () => {
              const d = await createDataset({ name });
              setMsg(`Created ${d.name}`);
              setName("");
              setSelectedId(d.id);
              reload();
            }}
          >
            Create
          </Button>
          <Button
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
              setMsg("Exported");
            }}
          >
            Export
          </Button>
          <label className="cursor-pointer">
            <span className="inline-flex h-8 items-center rounded-md border border-border bg-white px-3 text-xs">
              Import JSONL
            </span>
            <input
              type="file"
              accept=".json,.jsonl,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !selectedId) return;
                const text = await file.text();
                let body: unknown = text;
                try {
                  body = JSON.parse(text);
                } catch {
                  body = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
                }
                await importDataset(selectedId, body);
                setMsg("Imported");
                reload();
              }}
            />
          </label>
        </div>
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
        {!loading && items.length === 0 ? <EmptyBlock title="No items" /> : null}
        <div className="overflow-auto rounded-lg border border-border bg-white">
          <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-ink/60">
                <th className="px-3 py-2">Thumb</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Expectation</th>
                <th className="px-3 py-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const media = it.media?.[0];
                const src = media ? mediaFileUrl(media.url || media.id) : "";
                return (
                  <tr
                    key={it.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/60"
                    onClick={() => setItem(it)}
                  >
                    <td className="px-3 py-1.5">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-10 w-10 rounded border object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed text-[10px] text-ink/40">
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{it.id.slice(0, 10)}…</td>
                    <td className="max-w-xs truncate px-3 py-1.5">
                      {typeof it.input === "string" ? it.input : JSON.stringify(it.input)}
                    </td>
                    <td className="max-w-xs truncate px-3 py-1.5">
                      {JSON.stringify(it.expectation || {})}
                    </td>
                    <td className="px-3 py-1.5">{(it.tags || []).join(", ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Sheet open={!!item} onOpenChange={(o) => !o && setItem(null)}>
          <SheetContent title={item?.id || "Item"}>
            {item ? (
              <pre className="mono overflow-auto text-[11px]">{JSON.stringify(item, null, 2)}</pre>
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </>
  );
}

function SnapshotDatasets() {
  const { data, loading, error } = useSuite();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CaseRow | null>(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.cases || []).filter(
      (c) =>
        !needle ||
        c.id.toLowerCase().includes(needle) ||
        (c.question || "").toLowerCase().includes(needle),
    );
  }, [data.cases, q]);

  return (
    <>
      <Topbar title="Datasets (snapshot)" />
      <main className="space-y-3 p-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter cases…" className="max-w-sm" />
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
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
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/60"
                  onClick={() => setSelected(c)}
                >
                  <td className="px-3 py-1.5">
                    {c.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.image} alt="" className="h-10 w-10 rounded border object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed text-[10px]">
                        AUD
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-medium">{c.id}</td>
                  <td className="px-3 py-1.5">{c.family || "—"}</td>
                  <td className="max-w-md truncate px-3 py-1.5">{c.question || "—"}</td>
                  <td className="px-3 py-1.5">{c.answer || "—"}</td>
                  <td className="px-3 py-1.5">
                    {caseTags(c.tags).map((t) => (
                      <Badge key={t} className="mr-1 border-border bg-muted">
                        {t}
                      </Badge>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent title={selected?.id || "Case"}>
            {selected ? <pre className="mono text-[11px]">{JSON.stringify(selected, null, 2)}</pre> : null}
          </SheetContent>
        </Sheet>
      </main>
    </>
  );
}
