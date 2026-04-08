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
  const message = typeof params.message === "string" ? params.message : "";
  const nextPath = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/";

  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <h1 className="text-xl font-semibold">ログイン</h1>
      <p className="mt-2 text-sm text-muted-foreground">メールアドレスとパスワードでログインします。</p>

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <form action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={nextPath} />
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
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="********"
          />
        </div>

        <Button type="submit" className="w-full">
          ログイン
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        研究室代表者として初めて利用する場合は <Link href="/signup" className="underline">代表者登録</Link>
      </p>
    </section>
  );
}
