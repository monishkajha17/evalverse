import fs from "fs";
import path from "path";
import type { SuiteData } from "./types";

/** Build-time helper: list all trace ids across suites for static params. */
export function collectTraceIdsFromFs(): { id: string }[] {
  const dir = path.join(process.cwd(), "public", "data");
  const ids = new Set<string>();
  if (!fs.existsSync(dir)) return [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as SuiteData;
      for (const t of raw.traces || []) {
        if (t?.id) ids.add(t.id);
      }
    } catch {
      // skip bad files
    }
  }
  return [...ids].map((id) => ({ id }));
}
