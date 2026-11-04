import { collectTraceIdsFromFs } from "@/lib/static-params";
import { TraceDetailClient } from "./trace-detail-client";

export function generateStaticParams() {
  return collectTraceIdsFromFs();
}

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  return <TraceDetailClient id={resolved.id} />;
}
