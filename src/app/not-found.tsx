import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border bg-background p-6 text-center shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">ページが見つかりません</h1>
          <p className="text-sm text-muted-foreground">
            URLが変更されたか、削除された可能性があります。
          </p>
        </div>
        <Link href="/">
          <Button type="button" variant="outline">
            ホームへ戻る
          </Button>
        </Link>
      </div>
    </main>
  );
}
