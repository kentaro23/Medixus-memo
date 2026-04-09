"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
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
        <h1 className="text-xl font-semibold">ワークスペースでエラーが発生しました</h1>
        <p className="text-sm text-muted-foreground">
          画面を再読み込みするか、再試行してください。
        </p>
      </div>
      <Button type="button" onClick={reset}>
        再試行
      </Button>
    </section>
  );
}
