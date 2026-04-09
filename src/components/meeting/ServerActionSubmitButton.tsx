"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type ButtonVariant = "default" | "outline" | "destructive" | "secondary" | "ghost" | "link";

export function ServerActionSubmitButton({
  idleLabel,
  pendingLabel,
  variant = "default",
  disabled = false,
}: {
  idleLabel: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={disabled || pending}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
