"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSuite } from "@/context/suite-context";
import { Badge } from "@/components/ui/badge";

export function Topbar({ title, children }: { title: string; children?: React.ReactNode }) {
  const { index, suite, setSuite, entry, loading } = useSuite();

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-paper/95 px-4 backdrop-blur">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold text-ink">{title}</h1>
      </div>
      {children}
      <div className="flex items-center gap-2">
        {entry ? (
          <Badge className="border-border bg-white text-ink/70">
            {entry.modality} · {entry.n_cases} cases
          </Badge>
        ) : null}
        <div className="w-44">
          <Select value={suite || undefined} onValueChange={setSuite} disabled={loading || !index.length}>
            <SelectTrigger aria-label="Select suite">
              <SelectValue placeholder="Suite" />
            </SelectTrigger>
            <SelectContent>
              {index.map((e) => (
                <SelectItem key={e.suite} value={e.suite}>
                  {e.suite}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
