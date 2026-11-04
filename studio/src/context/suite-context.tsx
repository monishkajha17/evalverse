"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { emptySuite, loadIndex, loadSuite } from "@/lib/data";
import type { SuiteData, SuiteIndexEntry } from "@/lib/types";

const STORAGE_KEY = "evalverse.suite";

interface SuiteContextValue {
  index: SuiteIndexEntry[];
  suite: string;
  setSuite: (suite: string) => void;
  data: SuiteData;
  loading: boolean;
  error: string | null;
  entry: SuiteIndexEntry | null;
  reload: () => void;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

export function SuiteProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<SuiteIndexEntry[]>([]);
  const [suite, setSuiteState] = useState<string>("");
  const [data, setData] = useState<SuiteData>(emptySuite());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await loadIndex();
        if (cancelled) return;
        setIndex(idx);
        const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const initial =
          (saved && idx.some((e) => e.suite === saved) && saved) ||
          idx[0]?.suite ||
          "default";
        setSuiteState(initial);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load index");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!suite) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const payload = await loadSuite(suite);
        if (cancelled) return;
        setData(payload);
        localStorage.setItem(STORAGE_KEY, suite);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load suite");
          setData(emptySuite());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suite, tick]);

  const setSuite = useCallback((next: string) => {
    setSuiteState(next);
  }, []);

  const entry = useMemo(
    () => index.find((e) => e.suite === suite) || null,
    [index, suite],
  );

  const value = useMemo(
    () => ({
      index,
      suite,
      setSuite,
      data,
      loading,
      error,
      entry,
      reload: () => setTick((t) => t + 1),
    }),
    [index, suite, setSuite, data, loading, error, entry],
  );

  return <SuiteContext.Provider value={value}>{children}</SuiteContext.Provider>;
}

export function useSuite() {
  const ctx = useContext(SuiteContext);
  if (!ctx) throw new Error("useSuite must be used within SuiteProvider");
  return ctx;
}
