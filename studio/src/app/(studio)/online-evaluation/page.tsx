"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { OnboardingEmpty } from "@/components/studio/onboarding-empty";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiMode } from "@/context/api-mode";
import {
  createPolicy,
  listAlerts,
  listEvaluators,
  listPolicies,
  listTraces,
  updatePolicy,
  type Alert,
  type Policy,
} from "@/lib/api";

const DEMO_POLICIES: Policy[] = [
  {
    id: "demo-grounding",
    name: "Grounded answers",
    enabled: true,
    sample_rate: 1,
    evaluator_ids: ["evidence_grounding", "answer_correctness"],
    filter: { source: "sdk" },
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-hallucination",
    name: "Hallucination watch",
    enabled: false,
    sample_rate: 0.25,
    evaluator_ids: ["fabrication_check"],
    filter: { tag: "production" },
    created_at: new Date().toISOString(),
  },
];

export default function OnlineEvaluationPage() {
  const { mode, signedIn } = useApiMode();
  const [tab, setTab] = useState("policies");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [evals, setEvals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sampleRate, setSampleRate] = useState("1");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [filterText, setFilterText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode !== "live") {
        setPolicies(DEMO_POLICIES);
        setAlerts([]);
        setEvals(["evidence_grounding", "answer_correctness", "fabrication_check"]);
        setEvaluatorId("evidence_grounding");
        return;
      }
      const [p, a, ev] = await Promise.all([listPolicies(), listAlerts(), listEvaluators()]);
      setPolicies(p);
      setAlerts(a);
      setEvals(ev.map((e) => e.id));
      if (!evaluatorId && ev[0]) setEvaluatorId(ev[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load policies");
      setPolicies([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function togglePolicy(p: Policy, enabled: boolean) {
    if (mode !== "live") {
      setPolicies((prev) => prev.map((x) => (x.id === p.id ? { ...x, enabled } : x)));
      setMsg(signedIn ? "Saved locally until the server is reachable." : "Sign in to save policy changes.");
      return;
    }
    try {
      const updated = await updatePolicy(p.id, { enabled });
      setPolicies((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update policy");
    }
  }

  async function onCreate() {
    if (!name.trim() || !evaluatorId) return;
    if (mode !== "live") {
      setPolicies((prev) => [
        {
          id: `demo-${Date.now()}`,
          name: name.trim(),
          enabled: true,
          sample_rate: Number(sampleRate) || 1,
          evaluator_ids: [evaluatorId],
          filter: filterText ? { query: filterText } : {},
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setMsg(signedIn ? "Policy drafted in demo mode." : "Sign in to save policies.");
      setName("");
      return;
    }
    try {
      const created = await createPolicy({
        name: name.trim(),
        sample_rate: Number(sampleRate) || 1,
        evaluator_ids: [evaluatorId],
        filter: filterText ? { query: filterText } : undefined,
        enabled: true,
      });
      setPolicies((prev) => [created, ...prev]);
      setName("");
      setMsg("Policy created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create policy");
    }
  }

  const filtered = policies.filter((p) =>
    !filterText ? true : (p.name || "").toLowerCase().includes(filterText.toLowerCase()),
  );

  const alerts24h = alerts.filter((a) => {
    if (!a.created_at) return true;
    return Date.now() - new Date(a.created_at).getTime() < 24 * 3600 * 1000;
  });

  const liveEmpty = mode === "live" && !loading && !error && policies.length === 0 && alerts.length === 0;

  return (
    <>
      <Topbar hideTitle />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Online evaluation"
          description="Policies automatically check live traces. Choose which traces, how many, and which evaluators."
          action={
            <Button type="button" size="sm" onClick={() => setTab("new")}>
              New policy
            </Button>
          }
        />

        {error ? <ErrorState title="Couldn't load online evaluation" detail={error} onRetry={reload} /> : null}
        {liveEmpty ? (
          <OnboardingEmpty title="No online evaluation data yet" onSeeded={reload} />
        ) : null}

        {!error && !liveEmpty ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="policies">Policies</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="new">New policy</TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="space-y-3">
            <FilterBar>
              <Input
                className="h-8 max-w-xs"
                placeholder="Filter policies"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                aria-label="Filter policies"
              />
              <Button type="button" size="sm" variant="outline" onClick={reload}>
                Refresh
              </Button>
            </FilterBar>
            {msg ? <p className="text-xs text-ink-muted">{msg}</p> : null}
            {loading ? <SkeletonBlock /> : null}
            {!loading && !filtered.length ? (
              <EmptyState
                title="No policies yet"
                detail="Create a policy to score a sample of incoming traces automatically."
                action={
                  <Button type="button" size="sm" onClick={() => setTab("new")}>
                    New policy
                  </Button>
                }
              />
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {filtered.map((p) => (
                <Card key={p.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-sm">{p.name || p.id}</CardTitle>
                      <p className="mt-1 text-xs text-ink/50">
                        Traces: {summarizeFilter(p.filter)} · Sample {Math.round((p.sample_rate ?? 1) * 100)}%
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(p.enabled)}
                      onCheckedChange={(v) => togglePolicy(p, v)}
                      aria-label={`Toggle ${p.name}`}
                    />
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-ink/70">
                    <div className="flex flex-wrap gap-1">
                      {(p.evaluator_ids || []).map((id) => (
                        <Badge key={id} className="border-border bg-muted text-ink/70">
                          {id}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3 text-ink/50">
                      <span>Last triggered —</span>
                      <span>Alerts in 24 h: {alerts24h.filter((a) => a.policy_id === p.id).length}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-3">
            {!alerts24h.length ? (
              <EmptyState
                title="No alerts in the last 24 hours"
                detail="When a policy fails its threshold, alerts will show up here."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-white">
                <table className="sticky-table w-full text-left text-xs">
                  <thead>
                    <tr className="text-ink/55">
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Policy</th>
                      <th className="px-3 py-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts24h.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2">{a.policy_id || "—"}</td>
                        <td className="px-3 py-2">
                          {String(a.message || a.kind || "Alert")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New policy</CardTitle>
              </CardHeader>
              <CardContent className="grid max-w-lg gap-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-ink/55">Name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production grounding" />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-ink/55">Which traces</span>
                  <Input
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="e.g. source is sdk"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-ink/55">Sample rate (0–1)</span>
                  <Input value={sampleRate} onChange={(e) => setSampleRate(e.target.value)} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-ink/55">Evaluator</span>
                  <select
                    className="h-9 rounded-md border border-border bg-white px-2 text-sm"
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
                <Button type="button" onClick={onCreate} disabled={!name.trim() || !evaluatorId}>
                  Create policy
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        ) : null}
      </main>
    </>
  );
}

function summarizeFilter(filter: Record<string, unknown> | undefined | null) {
  if (!filter || !Object.keys(filter).length) return "all traces";
  return Object.entries(filter)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}
