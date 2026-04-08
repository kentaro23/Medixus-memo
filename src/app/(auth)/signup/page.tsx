import Link from "next/link";

import { Button } from "@/components/ui/button";

import { signUpAction } from "../actions";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SignUpPage({
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
      <h1 className="text-xl font-semibold">新規登録</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Magic Link でサインアップします。パスワードは不要です。
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sent ? (
        <p className="mt-4 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {email || "指定のメールアドレス"} 宛に登録リンクを送信しました。
        </p>
      ) : null}

      <form action={signUpAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value="/orgs/new" />
        <div className="space-y-2">
          <label htmlFor="fullName" className="text-sm font-medium">
            氏名（任意）
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="北里 健太郎"
          />
        </div>
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
          登録リンクを送信
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        すでに登録済みの場合は <Link href="/login" className="underline">ログイン</Link>
      </p>
    </section>
  );
}
