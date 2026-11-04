"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HighlightedCode } from "@/components/marketing/highlighted-code";
import { useApiMode } from "@/context/api-mode";
import {
  defaultApiUrl,
  maskKey,
  readSession,
  writeSession,
  type EvalVerseSession,
} from "@/lib/session";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mk-btn mk-btn-secondary min-h-[36px] px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function GetStartedPage() {
  const router = useRouter();
  const { connect, refresh, switchToDemo } = useApiMode();
  const [session, setSession] = useState<EvalVerseSession | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.replace("/signup/");
      return;
    }
    setSession(s);
    if (s.apiKey.startsWith("evk_")) {
      setRawKey(s.apiKey);
      setRevealed(true);
      const t = window.setTimeout(() => setRevealed(false), 12_000);
      return () => window.clearTimeout(t);
    }
    // Login path: mint a key with the session token
    (async () => {
      try {
        const res = await fetch(`${s.apiUrl}/api/v1/api-keys`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${s.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ name: "studio", project: s.project }),
        });
        if (!res.ok) throw new Error(`Could not create API key (${res.status})`);
        const data = (await res.json()) as { key: string };
        const next = { ...s, apiKey: data.key };
        writeSession(next);
        await connect({
          url: next.apiUrl,
          apiKey: next.apiKey,
          project: next.project,
          preferLive: true,
        });
        refresh();
        setSession(next);
        setRawKey(data.key);
        setRevealed(true);
        window.setTimeout(() => setRevealed(false), 12_000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create API key");
      }
    })();
  }, [router, connect, refresh]);

  const snippets = useMemo(() => {
    const key = rawKey || session?.apiKey || "evk_…";
    const url = session?.apiUrl || defaultApiUrl();
    const project = session?.project || "default";
    const sdk = `from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="${url}", api_key="${key}", project="${project}")

with ev.trace(name="hello", agent="muse-spark-1.3") as tr:
    tr.set_output(answer="ok")
ev.flush()`;
    const otel = `from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="${url}/v1/traces",
    headers={
        "authorization": "Bearer ${key}",
        "x-project": "${project}",
    },
)`;
    return { sdk, otel, key, url, project };
  }, [rawKey, session]);

  async function sendSample() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setUnreachable(false);
    try {
      const res = await fetch(`${session.apiUrl}/api/v1/onboarding/sample-trace`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.apiKey}`,
          "X-Project": session.project,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 180) || `Sample failed (${res.status})`);
      }
      const data = (await res.json()) as { trace_id: string };
      setSampleId(data.trace_id);
    } catch (e) {
      if (e instanceof TypeError) {
        setUnreachable(true);
      } else {
        setError(e instanceof Error ? e.message : "Sample failed");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-sm text-[var(--mk-muted)]">
        Loading session…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-14 sm:px-6">
      <p className="mk-label">Get started</p>
      <h1 className="mk-headline mt-3 text-4xl">Three steps to a live Studio</h1>
      <p className="mt-3 text-sm text-[var(--mk-muted)]">
        Signed in as {session.email || session.name || "you"} · project{" "}
        <span className="mk-mono text-[var(--mk-accent)]">{session.project}</span>
      </p>

      <ol className="mt-10 space-y-8">
        <li className="mk-panel p-5">
          <div className="mk-label">01 / API key</div>
          <p className="mt-2 text-sm text-[var(--mk-muted)]">
            Shown once. Copy it now — Studio stores it locally as{" "}
            <span className="mk-mono">evalverse.session</span>.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="mk-mono rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-2 text-sm">
              {revealed && rawKey ? rawKey : maskKey(rawKey || session.apiKey)}
            </code>
            {rawKey ? <CopyButton text={rawKey} /> : null}
            {rawKey && !revealed ? (
              <button type="button" className="mk-btn mk-btn-ghost" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            ) : null}
          </div>
        </li>

        <li className="mk-panel space-y-4 p-5">
          <div className="mk-label">02 / Install and send a trace</div>
          <HighlightedCode code={snippets.sdk} label="sdk.py" />
          <div className="flex justify-end">
            <CopyButton text={snippets.sdk} />
          </div>
          <HighlightedCode code={snippets.otel} label="otel.py" />
          <div className="flex justify-end">
            <CopyButton text={snippets.otel} />
          </div>
        </li>

        <li className="mk-panel p-5">
          <div className="mk-label">03 / Sample trace</div>
          <p className="mt-2 text-sm text-[var(--mk-muted)]">
            POST /api/v1/onboarding/sample-trace — media, model, tools and default evaluators.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="mk-btn mk-btn-primary" disabled={busy} onClick={sendSample}>
              {busy ? "Sending…" : "Send a sample trace"}
            </button>
            {sampleId ? (
              <Link href={`/traces/view/?id=${encodeURIComponent(sampleId)}`} className="mk-btn mk-btn-secondary">
                Open it in Studio
              </Link>
            ) : null}
          </div>
          {error ? <p className="mk-error mt-3">{error}</p> : null}
          {unreachable ? (
            <div className="mt-4 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.08)] p-4">
              <p className="text-sm">No EvalVerse server found at {session.apiUrl}</p>
              <p className="mk-mono mt-2 text-xs text-[var(--mk-muted)]">python -m evalverse.server</p>
              <button
                type="button"
                className="mk-btn mk-btn-secondary mt-3"
                onClick={() => {
                  switchToDemo();
                  router.push("/overview/");
                }}
              >
                Continue with demo data
              </button>
            </div>
          ) : null}
        </li>
      </ol>

      <div className="mt-8">
        <Link href="/overview/" className="mk-link-arrow">
          Skip to Studio <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
