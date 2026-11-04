"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  apiConfig,
  clearStoredConnection,
  health,
  writeStoredConnection,
  type StoredConnection,
} from "@/lib/api";
import { clearSession, readSession } from "@/lib/session";

export type StudioMode = "live" | "snapshot";

export type ConnectionBanner =
  | null
  | { kind: "demo" }
  | { kind: "session-expired" }
  | { kind: "unreachable"; detail?: string };

interface ApiModeValue {
  mode: StudioMode;
  liveAvailable: boolean;
  checking: boolean;
  error: string | null;
  hostLabel: string;
  projectLabel: string;
  /** User wants live project data (only meaningful when signed in). */
  preferLive: boolean;
  hasStoredConnection: boolean;
  signedIn: boolean;
  banner: ConnectionBanner;
  refresh: () => void;
  connect: (conn: Omit<StoredConnection, "preferLive"> & { preferLive?: boolean }) => Promise<void>;
  switchToDemo: () => void;
  switchToLive: () => void;
  disconnect: () => void;
  clearSessionExpired: () => void;
}

const ApiModeContext = createContext<ApiModeValue | null>(null);

export function ApiModeProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const promotedRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => apiConfig(), [tick]);

  useEffect(() => {
    const session = readSession();
    setSignedIn(Boolean(session?.token));
    // First sign-in: promote to live once if a session exists and preferLive was never set false intentionally.
    if (session?.token && !cfg.hasStoredConnection && !promotedRef.current) {
      promotedRef.current = true;
      writeStoredConnection({
        url: session.apiUrl || cfg.url,
        apiKey: session.apiKey || cfg.key,
        project: session.project || cfg.project || "default",
        preferLive: true,
      });
      setTick((t) => t + 1);
    }
  }, [tick, cfg.hasStoredConnection, cfg.url, cfg.key, cfg.project]);

  useEffect(() => {
    const onExpired = () => {
      clearSession();
      clearStoredConnection();
      setSignedIn(false);
      setSessionExpired(true);
      setLiveAvailable(false);
      setError(null);
      setTick((t) => t + 1);
    };
    window.addEventListener("evalverse:auth-expired", onExpired);
    return () => window.removeEventListener("evalverse:auth-expired", onExpired);
  }, []);

  const wantLive = Boolean(signedIn && cfg.preferLive && cfg.modeEnv !== "snapshot");

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    if (!wantLive) {
      setLiveAvailable(false);
      setChecking(false);
      setError(null);
      return () => {
        cancelled = true;
        ctrl.abort();
      };
    }

    setChecking(true);
    (async () => {
      try {
        await health(ctrl.signal);
        if (!cancelled) {
          setLiveAvailable(true);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setLiveAvailable(false);
          const msg = e instanceof Error ? e.message : "API unreachable";
          setError(msg);
          if (e instanceof ApiError && e.status === 401) {
            clearSession();
            clearStoredConnection();
            setSignedIn(false);
            setSessionExpired(true);
          } else {
            console.warn("[evalverse] can't reach server", e);
          }
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [wantLive, cfg.url, cfg.project, tick]);

  useEffect(() => {
    if (!wantLive) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [wantLive]);

  /** Live label only when signed in, preferring live, and API is healthy. Never label demo as Live. */
  const effectiveMode: StudioMode =
    signedIn && cfg.preferLive && liveAvailable && cfg.modeEnv !== "snapshot" ? "live" : "snapshot";

  const banner: ConnectionBanner = useMemo(() => {
    if (sessionExpired) return { kind: "session-expired" };
    if (signedIn && cfg.preferLive && !liveAvailable && !checking) {
      return { kind: "unreachable", detail: error || undefined };
    }
    if (!signedIn || !cfg.preferLive) return { kind: "demo" };
    return null;
  }, [sessionExpired, signedIn, cfg.preferLive, liveAvailable, checking, error]);

  const connect = useCallback(
    async (conn: Omit<StoredConnection, "preferLive"> & { preferLive?: boolean }) => {
      writeStoredConnection({
        url: conn.url,
        apiKey: conn.apiKey,
        project: conn.project || "default",
        preferLive: conn.preferLive !== false,
      });
      setSessionExpired(false);
      promotedRef.current = true;
      setTick((t) => t + 1);
    },
    [],
  );

  const switchToDemo = useCallback(() => {
    const existing = apiConfig();
    writeStoredConnection({
      url: existing.url,
      apiKey: existing.key,
      project: existing.hasStoredConnection ? existing.project : "default",
      preferLive: false,
    });
    setLiveAvailable(false);
    setError(null);
    setTick((t) => t + 1);
  }, []);

  const switchToLive = useCallback(() => {
    const session = readSession();
    const existing = apiConfig();
    writeStoredConnection({
      url: session?.apiUrl || existing.url,
      apiKey: session?.apiKey || existing.key,
      project: session?.project || existing.project || "default",
      preferLive: true,
    });
    setSessionExpired(false);
    setTick((t) => t + 1);
  }, []);

  const disconnect = useCallback(() => {
    clearStoredConnection();
    setLiveAvailable(false);
    setError(null);
    setSignedIn(false);
    promotedRef.current = false;
    setTick((t) => t + 1);
  }, []);

  const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

  const value = useMemo(
    () => ({
      mode: effectiveMode,
      liveAvailable,
      checking,
      error,
      hostLabel: cfg.hostLabel,
      projectLabel: cfg.project || readSession()?.project || "default",
      preferLive: Boolean(signedIn && cfg.preferLive),
      hasStoredConnection: cfg.hasStoredConnection,
      signedIn,
      banner,
      refresh: () => setTick((t) => t + 1),
      connect,
      switchToDemo,
      switchToLive,
      disconnect,
      clearSessionExpired,
    }),
    [
      effectiveMode,
      liveAvailable,
      checking,
      error,
      cfg.hostLabel,
      cfg.project,
      cfg.preferLive,
      cfg.hasStoredConnection,
      signedIn,
      banner,
      connect,
      switchToDemo,
      switchToLive,
      disconnect,
      clearSessionExpired,
    ],
  );

  return <ApiModeContext.Provider value={value}>{children}</ApiModeContext.Provider>;
}

export function useApiMode() {
  const ctx = useContext(ApiModeContext);
  if (!ctx) throw new Error("useApiMode must be used within ApiModeProvider");
  return ctx;
}

export function useLivePreferred() {
  const { mode } = useApiMode();
  return mode === "live";
}
