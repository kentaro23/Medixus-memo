import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function AuthCodeErrorPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4">
      <section className="w-full rounded-xl border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">認証に失敗しました</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ログインリンクが期限切れの可能性があります。もう一度ログインをお試しください。
        </p>
        <Link href="/login" className={`${buttonVariants({ variant: "default" })} mt-6 w-full`}>
          ログイン画面へ戻る
        </Link>
      </section>
    </main>
  );
}
