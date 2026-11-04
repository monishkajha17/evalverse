"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiConfig, health } from "@/lib/api";

export type StudioMode = "live" | "snapshot";

interface ApiModeValue {
  mode: StudioMode;
  liveAvailable: boolean;
  checking: boolean;
  error: string | null;
  refresh: () => void;
}

const ApiModeContext = createContext<ApiModeValue | null>(null);

export function ApiModeProvider({ children }: { children: React.ReactNode }) {
  const forced = apiConfig().modeEnv;
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (forced === "snapshot") {
      setLiveAvailable(false);
      setChecking(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
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
  }, [forced, tick]);

  // periodic re-check every 15s when supposed to be live
  useEffect(() => {
    if (forced === "snapshot") return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [forced]);

  const mode: StudioMode = forced === "snapshot" || !liveAvailable ? "snapshot" : "live";

  const value = useMemo(
    () => ({
      mode,
      liveAvailable,
      checking,
      error,
      refresh: () => setTick((t) => t + 1),
    }),
    [mode, liveAvailable, checking, error],
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
