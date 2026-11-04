/**
 * Auth session for Studio Live mode.
 * Stored under `evalverse.session`; also mirrors into `evalverse.connection`.
 */

import { writeStoredConnection, clearStoredConnection, apiConfig } from "@/lib/api";

export const SESSION_STORAGE_KEY = "evalverse.session";

export type EvalVerseSession = {
  token: string;
  apiKey: string;
  apiUrl: string;
  project: string;
  email?: string;
  name?: string;
};

export function defaultApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function readSession(): EvalVerseSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EvalVerseSession>;
    if (!parsed.token || !parsed.apiKey || !parsed.apiUrl) return null;
    return {
      token: String(parsed.token),
      apiKey: String(parsed.apiKey),
      apiUrl: String(parsed.apiUrl).replace(/\/$/, ""),
      project: String(parsed.project || "default"),
      email: parsed.email ? String(parsed.email) : undefined,
      name: parsed.name ? String(parsed.name) : undefined,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: EvalVerseSession) {
  if (typeof window === "undefined") return;
  const normalized: EvalVerseSession = {
    ...session,
    apiUrl: session.apiUrl.replace(/\/$/, ""),
    project: session.project || "default",
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
  writeStoredConnection({
    url: normalized.apiUrl,
    apiKey: normalized.apiKey,
    project: normalized.project,
    preferLive: true,
  });
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_STORAGE_KEY);
  clearStoredConnection();
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "••••••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export type AuthError =
  | { kind: "unreachable"; url: string }
  | { kind: "http"; status: number; message: string }
  | { kind: "validation"; message: string };

export async function authRequest<T>(
  path: string,
  body: Record<string, unknown>,
  apiUrl?: string,
): Promise<{ ok: true; data: T } | { ok: false; error: AuthError }> {
  const base = (apiUrl || defaultApiUrl()).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: { kind: "unreachable", url: base } };
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed &&
      "error" in parsed &&
      typeof (parsed as { error?: { message?: string } }).error?.message === "string"
        ? (parsed as { error: { message: string } }).error.message
        : typeof parsed === "object" && parsed && "detail" in parsed
          ? String((parsed as { detail: unknown }).detail)
          : `Request failed (${res.status})`;
    return { ok: false, error: { kind: "http", status: res.status, message: msg } };
  }
  return { ok: true, data: parsed as T };
}

export type RegisterResponse = {
  user: { id: string; email: string; name?: string | null; created_at?: string };
  token: string;
  project: string;
  api_key: string;
};

export type LoginResponse = {
  user: { id: string; email: string; name?: string | null; created_at?: string };
  token: string;
  projects: string[];
};

/** Apply register/login payload into session + Live connection. */
export function applyAuthSuccess(
  data: RegisterResponse | (LoginResponse & { api_key?: string }),
  apiUrl: string,
  apiKeyFallback?: string,
) {
  const apiKey =
    "api_key" in data && data.api_key
      ? data.api_key
      : apiKeyFallback || readSession()?.apiKey || apiConfig().key;
  const project =
    "project" in data && typeof data.project === "string"
      ? data.project
      : Array.isArray((data as LoginResponse).projects)
        ? (data as LoginResponse).projects[0] || "default"
        : "default";
  writeSession({
    token: data.token,
    apiKey,
    apiUrl,
    project,
    email: data.user.email,
    name: data.user.name || undefined,
  });
}
