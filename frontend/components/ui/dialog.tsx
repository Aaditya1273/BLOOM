"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bloom-fade fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "bloom-pop fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-card border border-line bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-md outline-none",
          "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:pb-6",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close aria-label="Close" className="absolute top-4 right-4 grid size-9 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("pr-10 text-xl font-semibold tracking-[-0.02em]", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm text-muted", className)} {...props} />;
}
