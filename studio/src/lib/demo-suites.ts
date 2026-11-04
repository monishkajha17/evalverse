import type { SuiteIndexEntry } from "./types";

export type DemoSuiteMeta = {
  suite: string;
  title: string;
  description: string;
  featured?: boolean;
};

/** Friendly catalog for the Demo data picker. Unknown suites still appear with a fallback title. */
export const DEMO_SUITE_CATALOG: Record<string, Omit<DemoSuiteMeta, "suite">> = {
  cord: {
    title: "Receipts",
    description: "30 real CORD receipts",
    featured: true,
  },
  audio: {
    title: "Spoken conversations",
    description: "12 LibriSpeech conversations",
    featured: true,
  },
  video: {
    title: "Register videos",
    description: "12 generated register clips",
    featured: true,
  },
  generated: {
    title: "Generated receipts",
    description: "21 synthetic receipts and charts",
    featured: true,
  },
  wonder: {
    title: "Independent judge",
    description: "Muse Wonder grades Muse Spark",
    featured: true,
  },
  crossmodal: {
    title: "Cross-modal",
    description: "Claim vs receipt consistency checks",
    featured: true,
  },
  lists: {
    title: "Menu lists",
    description: "List completeness and fabrication checks",
  },
  default: {
    title: "Default suite",
    description: "Exported evaluation snapshot",
  },
};

const FEATURED_ORDER = ["cord", "audio", "video", "generated", "wonder", "crossmodal"];

export function describeSuite(entry: SuiteIndexEntry): DemoSuiteMeta {
  const meta = DEMO_SUITE_CATALOG[entry.suite];
  if (meta) return { suite: entry.suite, ...meta };
  const modality = entry.modality?.replace(/_/g, " ") || "mixed";
  return {
    suite: entry.suite,
    title: entry.suite.replace(/_/g, " "),
    description: `${entry.n_cases} ${modality} cases`,
  };
}

export function orderedDemoSuites(index: SuiteIndexEntry[]): DemoSuiteMeta[] {
  const byId = new Map(index.map((e) => [e.suite, describeSuite(e)]));
  const out: DemoSuiteMeta[] = [];
  for (const id of FEATURED_ORDER) {
    const hit = byId.get(id);
    if (hit) {
      out.push(hit);
      byId.delete(id);
    }
  }
  for (const rest of byId.values()) out.push(rest);
  return out;
}
