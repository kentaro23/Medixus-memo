"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AuthError({
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
    <section className="space-y-4 rounded-xl border bg-background p-6 shadow-sm">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">認証処理でエラーが発生しました</h1>
        <p className="text-sm text-muted-foreground">
          セッションの有効期限切れや一時的な通信問題の可能性があります。
        </p>
      </div>
      <Button type="button" onClick={reset}>
        再試行
      </Button>
    </section>
  );
}
