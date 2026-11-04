"use client";

import { useEffect, useState } from "react";

export function DocToc({
  headings,
}: {
  headings: Array<{ id: string; text: string; level: number }>;
}) {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    if (!headings.length) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top > b.boundingClientRect.top ? 1 : -1));
        if (visible[0]?.target?.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [headings]);

  if (!headings.length) return null;

  return (
    <nav className="docs-toc" aria-label="On this page">
      <div className="mk-label mb-3">On this page</div>
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          className={active === h.id ? "is-active" : undefined}
          style={{ paddingLeft: 10 + (h.level - 2) * 10 }}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );
}
