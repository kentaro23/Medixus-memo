"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border bg-background p-6 text-center shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">エラーが発生しました</h1>
          <p className="text-sm text-muted-foreground">
            一時的な問題の可能性があります。再試行してください。
          </p>
        </div>
        <Button type="button" onClick={reset}>
          再試行
        </Button>
      </div>
    </main>
  );
}
