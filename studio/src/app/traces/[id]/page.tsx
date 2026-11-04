import { redirect } from "next/navigation";
import { collectTraceIdsFromFs } from "@/lib/static-params";

export function generateStaticParams() {
  return collectTraceIdsFromFs();
}

export default async function LegacyTracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/traces/view/?id=${encodeURIComponent(id)}`);
}
