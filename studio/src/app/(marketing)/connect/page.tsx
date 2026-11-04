"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <p className="mk-mono text-xs uppercase tracking-[0.14em] text-[var(--mk-accent)]">Connect</p>
      <h1 className="mk-headline mt-3 text-4xl">Connect your server</h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--mk-muted)]">
        Studio uses an API key. User accounts are on the roadmap.{" "}
        {mode === "live" ? (
          <span className="text-[var(--mk-teal)]">Currently live · {hostLabel}</span>
        ) : (
          <span>Currently on demo snapshot data.</span>
        )}
      </p>

      <div className="mk-panel mt-10 space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="mk-mono text-[11px] text-[var(--mk-muted)]">API URL</span>
          <input
            className="mk-mono h-11 w-full rounded-[10px] border border-[var(--mk-line)] bg-[#070d18] px-3 text-sm text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8000"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="mk-mono text-[11px] text-[var(--mk-muted)]">API key</span>
          <input
            type="password"
            className="mk-mono h-11 w-full rounded-[10px] border border-[var(--mk-line)] bg-[#070d18] px-3 text-sm text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Project</span>
          <input
            className="mk-mono h-11 w-full rounded-[10px] border border-[var(--mk-line)] bg-[#070d18] px-3 text-sm text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]"
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
            className={`text-xs ${ok ? "text-[var(--mk-teal)]" : "text-[var(--mk-crimson)]"}`}
          >
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            disabled={testing || !url || !apiKey}
            onClick={onTest}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="mk-btn mk-btn-secondary" onClick={onDemo}>
            Use demo data
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-[var(--mk-muted)]">
          Test calls <code className="mk-mono text-[var(--mk-accent)]">GET /api/v1/health</code>. On
          success, credentials are stored in{" "}
          <code className="mk-mono">localStorage</code> under{" "}
          <code className="mk-mono">evalverse.connection</code>. The key is never logged.
        </p>
      </div>

      <p className="mt-6 text-sm text-[var(--mk-muted)]">
        Or{" "}
        <Link href="/overview/" className="text-[var(--mk-accent)] hover:underline">
          open the demo
        </Link>{" "}
        without connecting.
      </p>
    </div>
  );
}
