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
  apiConfig,
  clearStoredConnection,
  health,
  writeStoredConnection,
  type StoredConnection,
} from "@/lib/api";
import { readSession } from "@/lib/session";

export type StudioMode = "live" | "snapshot";

interface ApiModeValue {
  mode: StudioMode;
  liveAvailable: boolean;
  checking: boolean;
  error: string | null;
  hostLabel: string;
  projectLabel: string;
  preferLive: boolean;
  hasStoredConnection: boolean;
  signedIn: boolean;
  refresh: () => void;
  connect: (conn: Omit<StoredConnection, "preferLive"> & { preferLive?: boolean }) => Promise<void>;
  switchToDemo: () => void;
  disconnect: () => void;
}

const ApiModeContext = createContext<ApiModeValue | null>(null);

export function ApiModeProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const promotedRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => apiConfig(), [tick]);

  useEffect(() => {
    const session = readSession();
    setSignedIn(Boolean(session?.token));
    if (session?.token && !cfg.preferLive && !promotedRef.current) {
      promotedRef.current = true;
      writeStoredConnection({
        url: session.apiUrl || cfg.url,
        apiKey: session.apiKey || cfg.key,
        project: session.project || cfg.project || "default",
        preferLive: true,
      });
      setTick((t) => t + 1);
    }
  }, [tick, cfg.preferLive, cfg.url, cfg.key, cfg.project]);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const session = readSession();
    const wantLive = Boolean(cfg.preferLive || session?.token);

    if (!wantLive || cfg.modeEnv === "snapshot") {
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
          setError(e instanceof Error ? e.message : "API unreachable");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [cfg.preferLive, cfg.modeEnv, cfg.url, cfg.project, tick]);

  useEffect(() => {
    const session = readSession();
    if (!cfg.preferLive && !session?.token) return;
    if (cfg.modeEnv === "snapshot") return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [cfg.preferLive, cfg.modeEnv]);

  const effectiveMode: StudioMode =
    liveAvailable && (cfg.preferLive || signedIn) && cfg.modeEnv !== "snapshot"
      ? "live"
      : "snapshot";

  const connect = useCallback(
    async (conn: Omit<StoredConnection, "preferLive"> & { preferLive?: boolean }) => {
      writeStoredConnection({
        url: conn.url,
        apiKey: conn.apiKey,
        project: conn.project || "default",
        preferLive: conn.preferLive !== false,
      });
      promotedRef.current = false;
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

  const disconnect = useCallback(() => {
    clearStoredConnection();
    setLiveAvailable(false);
    setError(null);
    setSignedIn(false);
    promotedRef.current = false;
    setTick((t) => t + 1);
  }, []);

  const value = useMemo(
    () => ({
      mode: effectiveMode,
      liveAvailable,
      checking,
      error,
      hostLabel: cfg.hostLabel,
      projectLabel: cfg.project || readSession()?.project || "default",
      preferLive: Boolean(cfg.preferLive || signedIn),
      hasStoredConnection: cfg.hasStoredConnection,
      signedIn,
      refresh: () => setTick((t) => t + 1),
      connect,
      switchToDemo,
      disconnect,
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
      connect,
      switchToDemo,
      disconnect,
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
