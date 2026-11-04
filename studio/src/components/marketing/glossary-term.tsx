"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/components/marketing/landing-constants";

/** Dotted-underline glossary term; keyboard accessible (Enter/Space, Escape). */
export function GlossaryTerm({
  term,
  children,
}: {
  term: GlossaryKey | string;
  children: React.ReactNode;
}) {
  const def = GLOSSARY[term as GlossaryKey] || GLOSSARY[term.toLowerCase() as GlossaryKey];
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  if (!def) {
    return <span>{children}</span>;
  }

  return (
    <span className="mk-gloss-wrap" ref={wrapRef}>
      <button
        type="button"
        className="mk-gloss"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children}
      </button>
      {open ? (
        <span id={tipId} role="tooltip" className="mk-gloss-tip">
          {def}
        </span>
      ) : null}
    </span>
  );
}
