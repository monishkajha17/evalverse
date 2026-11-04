import Link from "next/link";

const GITHUB = "https://github.com/monishkajha17/evalverse";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <div className="text-sm font-semibold text-ink">EvalVerse</div>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink/55">
            Multimodal agent evaluation with evidence, traces, and measured judges.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink/60">
          <Link href="/quickstart/" className="hover:text-ink">
            Quickstart
          </Link>
          <Link href="/overview/" className="hover:text-ink">
            Demo
          </Link>
          <Link href="/connect/" className="hover:text-ink">
            Connect
          </Link>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="hover:text-ink">
            GitHub
          </a>
        </div>
      </div>
      <div className="border-t border-border px-4 py-3 text-center text-[11px] text-ink/40 sm:px-6">
        Evaluation data attributions: CORD v2 and LibriSpeech (CC BY 4.0). Studio uses an API key;
        user accounts are on the roadmap.
      </div>
    </footer>
  );
}
