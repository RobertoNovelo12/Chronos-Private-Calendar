import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "h-9 w-full rounded-md border border-border-strong bg-background px-3 text-[13px] text-foreground placeholder:text-muted",
        "transition-shadow focus:outline-none focus:ring-2 focus:ring-ring",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
