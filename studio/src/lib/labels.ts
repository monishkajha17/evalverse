export const OUTCOME_META: Record<
  string,
  { text: string; bg: string; fg: string; border: string }
> = {
  grounded_correct: {
    text: "grounded correct",
    bg: "bg-teal/10",
    fg: "text-teal",
    border: "border-teal/30",
  },
  correct_ungrounded: {
    text: "correct, ungrounded",
    bg: "bg-amber/10",
    fg: "text-amber",
    border: "border-amber/30",
  },
  misread: {
    text: "misread",
    bg: "bg-slateish/10",
    fg: "text-slateish",
    border: "border-slateish/30",
  },
  mislocated: {
    text: "mislocated",
    bg: "bg-crimson/10",
    fg: "text-crimson",
    border: "border-crimson/30",
  },
  heard_wrong: {
    text: "heard wrong",
    bg: "bg-slateish/10",
    fg: "text-slateish",
    border: "border-slateish/30",
  },
  misunderstood: {
    text: "misunderstood",
    bg: "bg-amber/10",
    fg: "text-amber",
    border: "border-amber/30",
  },
  abstained: {
    text: "abstained",
    bg: "bg-grey/20",
    fg: "text-ink/70",
    border: "border-grey/40",
  },
  invalid_output: {
    text: "invalid output",
    bg: "bg-crimson/10",
    fg: "text-crimson",
    border: "border-crimson/30",
  },
  skipped: {
    text: "skipped",
    bg: "bg-grey/20",
    fg: "text-ink/60",
    border: "border-grey/40",
  },
};

export const OUTCOME_COLORS: Record<string, string> = {
  grounded_correct: "#0B8F7A",
  correct_ungrounded: "#C98512",
  misread: "#6A7B93",
  mislocated: "#D4285C",
  heard_wrong: "#6A7B93",
  misunderstood: "#C98512",
  abstained: "#A9B3C1",
  invalid_output: "#D4285C",
  other: "#A9B3C1",
};

export function outcomeMeta(label?: string | null) {
  if (!label) {
    return {
      text: "unknown",
      bg: "bg-grey/20",
      fg: "text-ink/60",
      border: "border-grey/40",
    };
  }
  return (
    OUTCOME_META[label] ?? {
      text: label.replace(/_/g, " "),
      bg: "bg-grey/20",
      fg: "text-ink/70",
      border: "border-grey/40",
    }
  );
}

export function verdictMeta(verdict?: string | null) {
  const v = (verdict || "").toLowerCase();
  if (v === "pass") return { text: "pass", className: "text-teal border-teal/30 bg-teal/10" };
  if (v === "fail") return { text: "fail", className: "text-crimson border-crimson/30 bg-crimson/10" };
  if (v === "not_applicable" || v === "n/a")
    return { text: verdict || "n/a", className: "text-ink/60 border-grey/40 bg-grey/15" };
  return { text: verdict || "—", className: "text-ink/70 border-border bg-muted" };
}
