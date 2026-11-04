"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApiMode } from "@/context/api-mode";
import { apiConfig, testHealth, unseedDemo } from "@/lib/api";
import { fetchAuthMe, friendlySampleError } from "@/lib/sample-data";
import { clearSession, readSession } from "@/lib/session";

type LocalKey = { id: string; prefix: string; last4: string; created: string; raw?: string };

export default function SettingsPage() {
  const router = useRouter();
  const { connect, switchToDemo, mode, hostLabel, projectLabel, disconnect, liveAvailable, refresh } =
    useApiMode();
  const [url, setUrl] = useState("http://127.0.0.1:8000");
  const [apiKey, setApiKey] = useState("");
  const [project, setProject] = useState("default");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [keys, setKeys] = useState<LocalKey[]>([]);
  const [newKeyOnce, setNewKeyOnce] = useState<string | null>(null);
  const [hasSampleData, setHasSampleData] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sampleMsg, setSampleMsg] = useState<string | null>(null);

  useEffect(() => {
    const cfg = apiConfig();
    setUrl(cfg.url || "http://127.0.0.1:8000");
    setApiKey(cfg.hasStoredConnection ? cfg.key : "");
    setProject(cfg.project || projectLabel || "default");
    setEmail(readSession()?.email || null);
  }, [projectLabel]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "live" || !readSession()?.token) {
      setHasSampleData(false);
      return;
    }
    void fetchAuthMe()
      .then((me) => {
        if (!cancelled) setHasSampleData(Boolean(me.has_sample_data));
      })
      .catch(() => {
        if (!cancelled) setHasSampleData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, projectLabel]);

  async function onTest() {
    setTesting(true);
    setMessage(null);
    setOk(false);
    try {
      const health = await testHealth(url, apiKey || "dev");
      await connect({ url, apiKey: apiKey || "dev", project, preferLive: true });
      setOk(true);
      setMessage(`Connected (${health.status || "ok"}).`);
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  function createKey() {
    const raw = `evk_${crypto.randomUUID().replace(/-/g, "")}`;
    const row: LocalKey = {
      id: crypto.randomUUID(),
      prefix: raw.slice(0, 8),
      last4: raw.slice(-4),
      created: new Date().toISOString(),
      raw,
    };
    setKeys((prev) => [row, ...prev]);
    setNewKeyOnce(raw);
  }

  function copyKey() {
    if (!newKeyOnce) return;
    void navigator.clipboard.writeText(newKeyOnce);
    setMessage("API key copied. It won’t be shown again.");
  }

  function revokeKey(id: string) {
    setKeys((prev) => prev.filter((k) => k.id !== id));
    if (newKeyOnce) setNewKeyOnce(null);
  }

  function onSignOut() {
    clearSession();
    disconnect();
    router.push("/signin/");
  }

  async function onRemoveSample() {
    setRemoving(true);
    setSampleMsg(null);
    try {
      await unseedDemo();
      setHasSampleData(false);
      setConfirmRemove(false);
      setSampleMsg("Sample data removed.");
      refresh();
    } catch (err) {
      setSampleMsg(friendlySampleError(err, "Couldn’t remove sample data. Try again."));
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <Topbar title="Settings" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Settings"
          description="Manage this project’s connection, API keys, and who can access Studio."
        />

        <div className="mx-auto grid max-w-3xl gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink/55">Name</span>
                <span className="font-medium">{projectLabel || project}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink/55">Account</span>
                <span className="truncate text-xs">{email || "Not signed in"}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {email ? (
                  <Button type="button" size="sm" variant="outline" onClick={onSignOut}>
                    Sign out
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href="/signin/">Sign in</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {mode === "live" && hasSampleData ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Sample data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-ink-muted">
                  This project includes the onboarding sample workspace (tagged Sample).
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove sample data
                </Button>
                {sampleMsg ? <p className="text-xs text-ink-muted">{sampleMsg}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">API keys</CardTitle>
              <Button type="button" size="sm" onClick={createKey}>
                Create key
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {newKeyOnce ? (
                <div className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2">
                  <p className="font-medium text-ink">Copy this key now. It is shown only once.</p>
                  <code className="mt-1 block break-all font-mono text-[11px]">{newKeyOnce}</code>
                  <Button type="button" size="sm" className="mt-2" onClick={copyKey}>
                    Copy key
                  </Button>
                </div>
              ) : null}
              {!keys.length ? (
                <p className="text-ink/55">No keys created in this browser yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {keys.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="font-mono">
                        {k.prefix}…{k.last4}
                      </span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => revokeKey(k.id)}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Connection</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink/55">Status</span>
                <Badge
                  className={
                    mode === "live"
                      ? "border-teal/30 bg-teal/10 text-teal"
                      : "border-border bg-muted text-ink/70"
                  }
                >
                  {mode === "live" ? `Live · ${hostLabel}` : "Demo data"}
                </Badge>
                {liveAvailable ? null : mode !== "live" ? (
                  <span className="text-ink/45">Server not reachable</span>
                ) : null}
              </div>
              <label className="grid gap-1 text-xs">
                <span className="text-ink/55">API URL</span>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-ink/55">API key</span>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste a project key"
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-ink/55">Project</span>
                <Input value={project} onChange={(e) => setProject(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={onTest} disabled={testing}>
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={switchToDemo}>
                  Use demo data
                </Button>
              </div>
              {message ? (
                <p className={`text-xs ${ok ? "text-teal" : "text-crimson"}`}>{message}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-3 text-xs text-ink/50">
                <span>Invite teammates to this project</span>
                <Badge className="border-border bg-muted text-ink/55">Coming soon</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogTitle>Remove sample data?</DialogTitle>
          <DialogDescription>
            This deletes every trace and session tagged Sample in this project. Your own traces
            stay.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmRemove(false)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onRemoveSample} disabled={removing}>
              {removing ? "Removing…" : "Remove sample data"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
