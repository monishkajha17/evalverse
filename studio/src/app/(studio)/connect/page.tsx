"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiMode } from "@/context/api-mode";
import { apiConfig, testHealth } from "@/lib/api";

export default function ConnectPage() {
  const router = useRouter();
  const { connect, switchToDemo, mode, hostLabel } = useApiMode();
  const [url, setUrl] = useState("http://127.0.0.1:8000");
  const [apiKey, setApiKey] = useState("dev");
  const [project, setProject] = useState("default");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const cfg = apiConfig();
    setUrl(cfg.url || "http://127.0.0.1:8000");
    setApiKey(cfg.hasStoredConnection ? cfg.key : "dev");
    setProject(cfg.project || "default");
  }, []);

  async function onTest() {
    setTesting(true);
    setMessage(null);
    setOk(false);
    try {
      const health = await testHealth(url, apiKey);
      await connect({ url, apiKey, project, preferLive: true });
      setOk(true);
      setMessage(`Connected (${health.status || "ok"}). Switching Studio to Live.`);
      router.push("/overview/");
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  function onDemo() {
    switchToDemo();
    setMessage("Using demo snapshot data.");
    setOk(true);
    router.push("/overview/");
  }

  return (
    <>
      <Topbar title="Connect" />
      <main className="mx-auto w-full max-w-lg space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Connect your server</CardTitle>
            <CardDescription>
              Studio talks to your EvalVerse API with an API key. User accounts are on the roadmap.
              {mode === "live" ? (
                <span className="mt-1 block text-teal">Currently live · {hostLabel}</span>
              ) : (
                <span className="mt-1 block">Currently on demo snapshot data.</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink/70">API URL</span>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink/70">API key</span>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink/70">Project</span>
              <Input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="default"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {message ? (
              <p
                role="status"
                className={`text-xs ${ok ? "text-teal" : "text-crimson"}`}
              >
                {message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="teal" disabled={testing || !url || !apiKey} onClick={onTest}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Button type="button" variant="outline" onClick={onDemo}>
                Use demo data
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-ink/45">
              Test calls <code className="mono">GET /api/v1/health</code>. On success, credentials
              are stored in <code className="mono">localStorage</code> under{" "}
              <code className="mono">evalverse.connection</code>. The key is never logged.
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
