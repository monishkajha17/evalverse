import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtLatency(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  return `${s.toFixed(2)} s`;
}

export function fmtTokens(usage?: { input_tokens?: number; output_tokens?: number } | null): string {
  if (!usage) return "—";
  const i = usage.input_tokens ?? 0;
  const o = usage.output_tokens ?? 0;
  if (!i && !o) return "—";
  return `${i + o}`;
}

/** Trace ids use `|`; static export keeps that character in the path — do not %-encode. */
export function encodeTraceId(id: string): string {
  return id;
}

export function decodeTraceId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
