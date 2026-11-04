"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { useApiMode } from "@/context/api-mode";
import { apiConfig, testHealth } from "@/lib/api";
import { clearSession, readSession } from "@/lib/session";

export default function SettingsPage() {
  const router = useRouter();
  const { connect, switchToDemo, mode, hostLabel, disconnect } = useApiMode();
  const [url, setUrl] = useState("http://127.0.0.1:8000");
  const [apiKey, setApiKey] = useState("dev");
  const [project, setProject] = useState("default");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const cfg = apiConfig();
    setUrl(cfg.url || "http://127.0.0.1:8000");
    setApiKey(cfg.hasStoredConnection ? cfg.key : "dev");
    setProject(cfg.project || "default");
    setEmail(readSession()?.email || null);
  }, []);

  async function onTest() {
    setTesting(true);
    setMessage(null);
    setOk(false);
    try {
      const health = await testHealth(url, apiKey);
      await connect({ url, apiKey, project, preferLive: true });
      setOk(true);
      setMessage(`Connected (${health.status || "ok"}). Studio is Live.`);
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

  function onSignOut() {
    clearSession();
    disconnect();
    router.push("/signin/");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar title="Settings" />
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-lg space-y-8">
          <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
            <h2 className="text-sm font-semibold text-ink">Account</h2>
            <p className="mt-1 text-xs text-ink/55">
              {email ? (
                <>Signed in as <span className="font-medium text-ink">{email}</span></>
              ) : (
                <>No account session. Use Sign in or connect a key below.</>
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {email ? (
                <button
                  type="button"
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-ink hover:bg-muted"
                  onClick={onSignOut}
                >
                  Sign out
                </button>
              ) : (
                <Link
                  href="/signin/"
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-ink hover:bg-muted"
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/signup/"
                className="rounded-md bg-ink px-3 py-1.5 text-xs text-white hover:bg-ink/90"
              >
                Create account
              </Link>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Advanced</p>
            <h2 className="mt-1 text-sm font-semibold text-ink">Connect a self-hosted server</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink/55">
              Paste an API URL and key without creating an account. Currently{" "}
              {mode === "live" ? (
                <span className="text-teal">live · {hostLabel}</span>
              ) : (
                <span>on demo snapshot data</span>
              )}
              .
            </p>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] text-ink/50">API URL</span>
                <input
                  className="h-9 w-full rounded-md border border-border bg-paper px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-teal/30"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-ink/50">API key</span>
                <input
                  type="password"
                  className="h-9 w-full rounded-md border border-border bg-paper px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-teal/30"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-ink/50">Project</span>
                <input
                  className="h-9 w-full rounded-md border border-border bg-paper px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-teal/30"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {message ? (
                <p className={`text-xs ${ok ? "text-teal" : "text-crimson"}`}>{message}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-md bg-ink px-3 py-1.5 text-xs text-white hover:bg-ink/90 disabled:opacity-50"
                  disabled={testing || !url || !apiKey}
                  onClick={onTest}
                >
                  {testing ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-ink hover:bg-muted"
                  onClick={onDemo}
                >
                  Use demo data
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink/45">
                Credentials are stored in localStorage under{" "}
                <code className="font-mono">evalverse.connection</code>. Keys are never logged.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
