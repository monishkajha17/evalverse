"use client";

import { useFadeUp } from "@/hooks/use-fade-up";

export function FadeUp({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const fade = useFadeUp();
  return (
    <div id={id} ref={fade.ref} className={`${fade.className} ${className}`}>
      {children}
    </div>
  );
}
