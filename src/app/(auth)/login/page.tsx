import Link from "next/link";

import { Button } from "@/components/ui/button";

import { signInAction } from "../actions";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await Promise.resolve(searchParams);
  const error = typeof params.error === "string" ? params.error : "";
  const sent = params.sent === "1";
  const email = typeof params.email === "string" ? params.email : "";

  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <h1 className="text-xl font-semibold">ログイン</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        登録済みメールアドレスに Magic Link を送信します。
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sent ? (
        <p className="mt-4 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {email || "指定のメールアドレス"} 宛にログインリンクを送信しました。
        </p>
      ) : null}

      <form action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value="/" />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" className="w-full">
          Magic Link を送信
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        アカウント未作成の場合は <Link href="/signup" className="underline">新規登録</Link>
      </p>
    </section>
  );
}
