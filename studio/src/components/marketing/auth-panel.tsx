"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  applyAuthSuccess,
  authRequest,
  defaultApiUrl,
  type LoginResponse,
  type RegisterResponse,
} from "@/lib/session";
import { useApiMode } from "@/context/api-mode";

function MiniTrace() {
  return (
    <svg viewBox="0 0 320 180" className="h-auto w-full" role="img" aria-label="Mini trace">
      <rect x="12" y="20" width="80" height="36" rx="8" fill="#0A1220" stroke="#1B2A41" />
      <text x="28" y="42" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
        media
      </text>
      <path d="M 92 38 H 130" stroke="#1B2A41" />
      <rect x="130" y="20" width="100" height="36" rx="8" fill="#0A1220" stroke="#8EC5FF" />
      <text x="148" y="42" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
        model
      </text>
      <path d="M 230 38 H 260" stroke="#1B2A41" />
      <rect x="260" y="20" width="48" height="36" rx="8" fill="#0A1220" stroke="#2DD4BF" />
      <text x="268" y="42" fill="#2DD4BF" style={{ fontSize: 10, fontFamily: "monospace" }}>
        eval
      </text>
      <rect x="12" y="80" width="296" height="72" rx="10" fill="#070d18" stroke="#1B2A41" />
      <rect x="28" y="98" width="160" height="8" rx="2" fill="#1B2A41" />
      <rect x="28" y="116" width="120" height="8" rx="2" fill="#1B2A41" />
      <rect x="200" y="108" width="70" height="28" rx="6" fill="rgba(45,212,191,0.1)" stroke="#2DD4BF" />
    </svg>
  );
}

function UnreachablePanel({ url, onDemo }: { url: string; onDemo: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.08)] p-4">
      <p className="text-sm text-[var(--mk-text)]">No EvalVerse server found at {url}</p>
      <p className="mk-mono mt-2 text-xs text-[var(--mk-muted)]">python -m evalverse.server</p>
      <button type="button" className="mk-btn mk-btn-secondary mt-4" onClick={onDemo}>
        Continue with demo data
      </button>
    </div>
  );
}

export function AuthForm({ mode }: { mode: "signup" | "signin" }) {
  const router = useRouter();
  const { connect, switchToDemo, refresh } = useApiMode();
  const apiUrl = defaultApiUrl();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnreachable(false);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter a valid email.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await authRequest<RegisterResponse>("/api/v1/auth/register", {
          email,
          password,
          name: name || undefined,
        });
        if (!res.ok) {
          if (res.error.kind === "unreachable") {
            setUnreachable(true);
            return;
          }
          setError(res.error.message);
          return;
        }
        applyAuthSuccess(res.data, apiUrl);
        await connect({
          url: apiUrl,
          apiKey: res.data.api_key,
          project: res.data.project,
          preferLive: true,
        });
        refresh();
        router.push("/get-started/");
      } else {
        const res = await authRequest<LoginResponse>("/api/v1/auth/login", { email, password });
        if (!res.ok) {
          if (res.error.kind === "unreachable") {
            setUnreachable(true);
            return;
          }
          setError(res.error.message);
          return;
        }
        // Login returns a session token; get-started mints an evk_ key if needed.
        applyAuthSuccess(res.data, apiUrl, res.data.token);
        const project = res.data.projects?.[0] || "default";
        await connect({
          url: apiUrl,
          apiKey: res.data.token,
          project,
          preferLive: true,
        });
        refresh();
        router.push("/get-started/");
      }
    } finally {
      setLoading(false);
    }
  }

  function onDemo() {
    switchToDemo();
    router.push("/overview/");
  }

  return (
    <div className="mx-auto grid max-w-[1040px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
      <div>
        <p className="mk-label">{mode === "signup" ? "Create account" : "Welcome back"}</p>
        <h1 className="mk-headline mt-3 text-4xl">
          {mode === "signup" ? "Start building with evidence" : "Sign in to EvalVerse"}
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--mk-muted)]">
          Local self-hosted auth. Your project and first API key stay on your server — not a hosted
          multi-tenant cloud.
        </p>
        <div className="mk-panel mt-8 p-4">
          <MiniTrace />
        </div>
      </div>

      <div>
        <form className="mk-panel space-y-4 p-5 sm:p-6" onSubmit={onSubmit} noValidate>
          {mode === "signup" ? (
            <label className="block space-y-1.5">
              <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Name</span>
              <input
                className="mk-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          ) : null}
          <label className="block space-y-1.5">
            <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Email</span>
            <input
              className="mk-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Password</span>
            <div className="relative">
              <input
                className="mk-field pr-16"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={8}
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 mk-mono text-[11px] text-[var(--mk-accent)]"
                onClick={() => setShow((v) => !v)}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          {error ? <p className="mk-error">{error}</p> : null}
          {unreachable ? <UnreachablePanel url={apiUrl} onDemo={onDemo} /> : null}
          <button type="submit" className="mk-btn mk-btn-primary w-full" disabled={loading}>
            {loading ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <p className="text-center text-xs text-[var(--mk-muted)]">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link href="/signin/" className="text-[var(--mk-accent)]">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/signup/" className="text-[var(--mk-accent)]">
                  Start building
                </Link>
              </>
            )}
          </p>
        </form>
        {!unreachable ? (
          <button type="button" className="mk-btn mk-btn-ghost mt-4" onClick={onDemo}>
            Continue with demo data →
          </button>
        ) : null}
      </div>
    </div>
  );
}
