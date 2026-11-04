/** Sample workspace helpers for Live mode onboarding. */

import { ApiError, apiConfig, listTraces } from "@/lib/api";
import { readSession } from "@/lib/session";

export const WELCOME_STORAGE_KEY = "evalverse.welcome";
export const SAMPLE_TAG = "sample";

export function isSampleTagged(tags?: string[] | null): boolean {
  return (tags || []).some((t) => String(t).toLowerCase() === SAMPLE_TAG);
}

/** Sessions from the sample pack use `sample:<short>` ids. */
export function isSampleSession(sessionId?: string | null): boolean {
  if (!sessionId) return false;
  return sessionId.startsWith("sample:");
}

export function markWelcomePending() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearWelcomePending() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(WELCOME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isWelcomePending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** User-facing message — never expose raw API/JSON errors. */
export function friendlySampleError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return "Sample data isn’t available on this server yet.";
    }
    if (err.status === 401 || err.status === 403) {
      return "You don’t have permission to change sample data.";
    }
    return fallback;
  }
  if (err instanceof TypeError) {
    return "Couldn’t reach the EvalVerse server.";
  }
  return fallback;
}

export async function fetchAuthMe(): Promise<{
  has_sample_data?: boolean;
  user?: { email?: string; name?: string | null };
  projects?: { name: string }[];
}> {
  const session = readSession();
  const cfg = apiConfig();
  const base = (session?.apiUrl || cfg.url).replace(/\/$/, "");
  const token = session?.token;
  if (!token) {
    throw new ApiError(401, "Not signed in");
  }
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new ApiError(res.status, "Could not load account", parsed);
  }
  return parsed as {
    has_sample_data?: boolean;
    user?: { email?: string; name?: string | null };
    projects?: { name: string }[];
  };
}

export async function findSampleTraceId(): Promise<string | null> {
  try {
    const rows = await listTraces({ limit: 50 });
    const hit = rows.find((r) => isSampleTagged(r.tags));
    return hit?.id || rows[0]?.id || null;
  } catch {
    return null;
  }
}
