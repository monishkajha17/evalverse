"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  apiConfig,
  clearStoredConnection,
  health,
  writeStoredConnection,
  type StoredConnection,
} from "@/lib/api";

export type StudioMode = "live" | "snapshot";

interface ApiModeValue {
  mode: StudioMode;
  liveAvailable: boolean;
  checking: boolean;
  error: string | null;
  hostLabel: string;
  preferLive: boolean;
  hasStoredConnection: boolean;
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
  // Re-read localStorage whenever tick changes (connect / disconnect / demo).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => apiConfig(), [tick]);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    if (!cfg.preferLive || cfg.modeEnv === "snapshot") {
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
    if (!cfg.preferLive || cfg.modeEnv === "snapshot") return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [cfg.preferLive, cfg.modeEnv]);

  const mode: StudioMode =
    !cfg.preferLive || cfg.modeEnv === "snapshot" || !liveAvailable ? "snapshot" : "live";

  const connect = useCallback(
    async (conn: Omit<StoredConnection, "preferLive"> & { preferLive?: boolean }) => {
      writeStoredConnection({
        url: conn.url,
        apiKey: conn.apiKey,
        project: conn.project || "default",
        preferLive: conn.preferLive !== false,
      });
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
    setTick((t) => t + 1);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      liveAvailable,
      checking,
      error,
      hostLabel: cfg.hostLabel,
      preferLive: cfg.preferLive,
      hasStoredConnection: cfg.hasStoredConnection,
      refresh: () => setTick((t) => t + 1),
      connect,
      switchToDemo,
      disconnect,
    }),
    [
      mode,
      liveAvailable,
      checking,
      error,
      cfg.hostLabel,
      cfg.preferLive,
      cfg.hasStoredConnection,
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
