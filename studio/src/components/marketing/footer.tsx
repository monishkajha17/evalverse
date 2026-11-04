import Link from "next/link";

const GITHUB = "https://github.com/monishkajha17/evalverse";

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--mk-line)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <div className="text-sm font-medium tracking-tight">EvalVerse</div>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-[var(--mk-muted)]">
            Built on the Meta Model API. Release 0.1.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mk-mono text-xs text-[var(--mk-muted)]">
          <a href={GITHUB} target="_blank" rel="noreferrer" className="hover:text-[var(--mk-text)]">
            GitHub ↗
          </a>
          <Link href="/quickstart/" className="hover:text-[var(--mk-text)]">
            Docs
          </Link>
          <Link href="/overview/" className="hover:text-[var(--mk-text)]">
            Studio
          </Link>
          <Link href="/connect/" className="hover:text-[var(--mk-text)]">
            Connect
          </Link>
        </div>
      </div>
      <div className="border-t border-[var(--mk-line)] px-4 py-4 text-center text-[11px] leading-relaxed text-[var(--mk-muted)] sm:px-6">
        Meta Model API · CORD v2 (CC BY 4.0) · LibriSpeech (CC BY 4.0) · Release 0.1
      </div>
    </footer>
  );
}
