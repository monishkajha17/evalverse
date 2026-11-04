import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-accent text-[var(--st-bg)] hover:bg-accent-hover",
        outline: "border border-border bg-surface text-ink hover:bg-muted",
        ghost: "text-ink-muted hover:bg-muted hover:text-ink",
        teal: "bg-teal text-[var(--st-bg)] hover:opacity-90",
        secondary: "bg-muted text-ink hover:bg-hairline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export function IconButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <Button type="button" size="icon" variant="ghost" className={cn("h-8 w-8", className)} {...props} />
  );
}
