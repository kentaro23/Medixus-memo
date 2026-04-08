import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Params = {
  token: string;
};

export default async function InviteTokenPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await Promise.resolve(params);
  const safeNext = `/invite/${token}`;

  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <h1 className="text-xl font-semibold">組織への招待</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        招待トークンを確認しました。アカウントでログイン後に参加処理を行います。
      </p>

      <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
        token: {token}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/signup?next=${encodeURIComponent(safeNext)}`}
          className={cn(buttonVariants({ variant: "default" }), "sm:flex-1")}
        >
          新規登録して参加
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent(safeNext)}`}
          className={cn(buttonVariants({ variant: "outline" }), "sm:flex-1")}
        >
          ログインして参加
        </Link>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        招待受諾フロー本体は Phase 2 で実装します。
      </p>
    </section>
  );
}
