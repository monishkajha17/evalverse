"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiMode } from "@/context/api-mode";
import {
  createPolicy,
  getQueue,
  listAlerts,
  listEvaluators,
  listPolicies,
  updatePolicy,
  type Alert,
  type Policy,
  type QueueStats,
} from "@/lib/api";

export default function PoliciesPage() {
  const { mode } = useApiMode();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [evals, setEvals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("studio-policy");
  const [sampleRate, setSampleRate] = useState("1");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    if (mode !== "live") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [p, a, q, ev] = await Promise.all([
        listPolicies(),
        listAlerts(),
        getQueue(),
        listEvaluators(),
      ]);
      setPolicies(p);
      setAlerts(a);
      setQueue(q);
      setEvals(ev.map((e) => e.id));
      if (!evaluatorId && ev[0]) setEvaluatorId(ev[0].id);
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
  }, [mode]);

  return (
    <>
      <Topbar title="Policies" />
      <main className="space-y-4 p-4">
        {mode === "snapshot" ? (
          <EmptyBlock title="Live mode required" detail="Online policies and alerts need the API." />
        ) : null}
        {msg ? <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{msg}</div> : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Queue depth" value={String(queue?.depth ?? "—")} />
          <Stat label="Running" value={String(queue?.running ?? "—")} />
          <Stat label="Completed" value={String(queue?.completed ?? "—")} />
          <Stat label="Failed" value={String(queue?.failed ?? "—")} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create policy</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-xs">
            <label>
              Name
              <Input className="mt-1 w-40" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Sample rate
              <Input
                className="mt-1 w-24"
                value={sampleRate}
                onChange={(e) => setSampleRate(e.target.value)}
              />
            </label>
            <label>
              Evaluator
              <select
                className="mt-1 h-8 rounded border border-border px-2"
                value={evaluatorId}
                onChange={(e) => setEvaluatorId(e.target.value)}
              >
                {evals.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={!name || mode !== "live"}
              onClick={async () => {
                const p = await createPolicy({
                  name,
                  sample_rate: Number(sampleRate) || 1,
                  evaluator_ids: evaluatorId ? [evaluatorId] : [],
                  enabled: true,
                  filter: {},
                });
                setMsg(`Created policy ${p.name}`);
                reload();
              }}
            >
              Create
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Online policies</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            {policies.length === 0 ? (
              <EmptyBlock title="No policies" />
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead>
                  <tr className="text-ink/60">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Sample rate</th>
                    <th className="px-2 py-2">Evaluators</th>
                    <th className="px-2 py-2">Enabled</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-2 py-1.5 font-medium">{p.name}</td>
                      <td className="px-2 py-1.5 tabular-nums">{p.sample_rate ?? 1}</td>
                      <td className="px-2 py-1.5">{(p.evaluator_ids || []).join(", ") || "—"}</td>
                      <td className="px-2 py-1.5">
                        <Badge
                          className={
                            p.enabled
                              ? "border-teal/30 bg-teal/10 text-teal"
                              : "border-grey/40 bg-grey/20 text-ink/60"
                          }
                        >
                          {p.enabled ? "enabled" : "disabled"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await updatePolicy(p.id, { enabled: !p.enabled });
                            setMsg(`${p.name} → ${!p.enabled ? "enabled" : "disabled"}`);
                            reload();
                          }}
                        >
                          {p.enabled ? "Disable" : "Enable"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <EmptyBlock title="No alerts" />
            ) : (
              <ul className="space-y-2 text-xs">
                {alerts.map((a, i) => (
                  <li key={a.id || i} className="rounded border border-border bg-paper px-3 py-2">
                    <div className="font-medium">{String(a.message || a.id || "alert")}</div>
                    <div className="text-ink/50">{a.created_at || ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
