import Link from "next/link";
import { GITHUB, RELEASE } from "@/components/marketing/landing-constants";

const COLS: Array<{ title: string; links: Array<{ href: string; label: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { href: "/#observe", label: "Observability" },
      { href: "/#evaluate", label: "Evaluation" },
      { href: "/try/", label: "Try it" },
      { href: "/#monitor", label: "Offline and online" },
      { href: "/overview/", label: "Open Studio" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs/quickstart/", label: "Quickstart" },
      { href: "/docs/sdk/", label: "SDK" },
      { href: "/docs/api/", label: "API reference" },
      { href: "/signup/", label: "Create an account" },
    ],
  },
  {
    title: "Open source",
    links: [
      { href: GITHUB, label: "GitHub", external: true },
      { href: `${GITHUB}/blob/main/LICENSE`, label: "License", external: true },
      { href: "/#measured", label: "What we found" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/marketing/ATTRIBUTION.txt", label: "Dataset attribution" },
      { href: "/#trust", label: "Judge disclosure" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--mk-line)]">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        {COLS.map((col) => (
          <div key={col.title}>
            <div className="mk-label">{col.title}</div>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--mk-muted)] hover:text-[var(--mk-text)]"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-[var(--mk-muted)] hover:text-[var(--mk-text)]">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--mk-line)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-2 text-[11px] leading-relaxed text-[var(--mk-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>Built on the Meta Model API · Muse Spark · Muse Wonder · Muse Voice Transcribe</p>
          <p>
            CORD v2 (CC BY 4.0) · LibriSpeech (CC BY 4.0) · Release {RELEASE}
          </p>
        </div>
      </div>
    </footer>
  );
}
