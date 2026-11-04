"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  children,
  side = "right",
  title = "Details",
  ...props
}: React.ComponentProps<typeof Dialog.Content> & { side?: "right" | "left"; title?: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex h-full w-full max-w-md flex-col border-border bg-white shadow-xl focus:outline-none",
          side === "right" ? "right-0 top-0 border-l" : "left-0 top-0 border-r",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Dialog.Title className="text-sm font-semibold text-ink">{title}</Dialog.Title>
          <Dialog.Close className="rounded p-1 text-ink/50 hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
