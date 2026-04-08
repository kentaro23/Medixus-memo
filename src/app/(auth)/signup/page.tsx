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

  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <h1 className="text-xl font-semibold">代表者登録</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        研究室・医局の代表者アカウントを作成します。メンバーのアカウント発行は登録後に設定画面から行えます。
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            パスワード（8文字以上）
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="********"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="passwordConfirm" className="text-sm font-medium">
            パスワード（確認）
          </label>
          <input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            minLength={8}
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="********"
          />
        </div>

        <Button type="submit" className="w-full">
          代表者アカウントを作成
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        すでに登録済みの場合は <Link href="/login" className="underline">ログイン</Link>
      </p>
    </section>
  );
}
