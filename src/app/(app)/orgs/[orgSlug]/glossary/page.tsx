import Link from "next/link";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  GLOSSARY_CATEGORY_OPTIONS,
  parseListInput,
  toNullableText,
} from "@/lib/glossary";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

type Params = { orgSlug: string };
type SearchParams = Record<string, string | string[] | undefined>;

type GlossaryTermRow = {
  id: string;
  term: string;
  reading: string | null;
  pronunciation_variants: string[] | null;
  definition: string | null;
  full_form: string | null;
  category: string | null;
  aliases: string[] | null;
  occurrence_count: number;
  correction_count: number;
  updated_at: string;
};

function redirectWithMessage(orgSlug: string, key: string, message: string): never {
  return redirect(`/orgs/${orgSlug}/glossary?${key}=${encodeURIComponent(message)}`);
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeSearchQuery(query: string) {
  return query.replace(/[%]/g, "").replace(/,/g, " ").trim();
}

async function createGlossaryTermAction(orgSlug: string, formData: FormData) {
  "use server";

  const nextPath = `/orgs/${orgSlug}/glossary`;
  const { supabase, organization, user } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const term = normalizeText(formData.get("term"));
  if (!term) {
    redirectWithMessage(orgSlug, "error", "term（用語）は必須です。");
  }

  const reading = toNullableText(normalizeText(formData.get("reading")));
  const pronunciationVariants = parseListInput(normalizeText(formData.get("pronunciationVariants")));
  const fullForm = toNullableText(normalizeText(formData.get("fullForm")));
  const category = toNullableText(normalizeText(formData.get("category")));
  const definition = toNullableText(normalizeText(formData.get("definition")));
  const detailedExplanation = toNullableText(normalizeText(formData.get("detailedExplanation")));
  const aliases = parseListInput(normalizeText(formData.get("aliases")));

  const { data: created, error: createError } = await supabase
    .from("glossary_terms")
    .insert({
      organization_id: organization.id,
      term,
      reading,
      pronunciation_variants: pronunciationVariants,
      definition,
      detailed_explanation: detailedExplanation,
      full_form: fullForm,
      category,
      aliases,
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (createError || !created) {
    if (createError?.code === "23505") {
      const { data: existing } = await supabase
        .from("glossary_terms")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("term", term)
        .maybeSingle<{ id: string }>();

      if (existing) {
        redirect(
          `/orgs/${orgSlug}/glossary/${existing.id}?info=${encodeURIComponent(
            "同じtermが既に存在したため、既存用語の編集画面を開きました。",
          )}`,
        );
      }
      redirectWithMessage(orgSlug, "error", "同じtermが既に存在します。");
    }

    redirectWithMessage(orgSlug, "error", `用語追加に失敗しました: ${createError?.message}`);
  }

  redirect(
    `/orgs/${orgSlug}/glossary/${created.id}?success=${encodeURIComponent("用語を追加しました。詳細を編集できます。")}`,
  );
}

export default async function GlossaryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);
  const nextPath = `/orgs/${orgSlug}/glossary`;

  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const rawQuery = typeof parsedSearchParams.q === "string" ? parsedSearchParams.q : "";
  const query = sanitizeSearchQuery(rawQuery);
  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";
  const success = typeof parsedSearchParams.success === "string" ? parsedSearchParams.success : "";
  const info = typeof parsedSearchParams.info === "string" ? parsedSearchParams.info : "";

  let glossaryQuery = supabase
    .from("glossary_terms")
    .select(
      "id, term, reading, pronunciation_variants, definition, full_form, category, aliases, occurrence_count, correction_count, updated_at",
    )
    .eq("organization_id", organization.id)
    .order("occurrence_count", { ascending: false })
    .order("term", { ascending: true })
    .limit(200);

  if (query) {
    glossaryQuery = glossaryQuery.or(
      `term.ilike.%${query}%,reading.ilike.%${query}%,definition.ilike.%${query}%,full_form.ilike.%${query}%`,
    );
  }

  const { data: glossaryTerms } = await glossaryQuery;
  const terms = (glossaryTerms ?? []) as GlossaryTermRow[];

  return (
    <PageShell
      title="用語辞書"
      description="用語の追加・検索・編集と、発音バリエーション管理を行います。"
      orgSlug={orgSlug}
    >
      <div className="flex flex-wrap gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={rawQuery}
            placeholder="用語/読み/定義で検索"
            className="w-64 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline">
            検索
          </Button>
          {rawQuery ? (
            <Link href={`/orgs/${orgSlug}/glossary`} className={cn(buttonVariants({ variant: "ghost" }))}>
              クリア
            </Link>
          ) : null}
        </form>

        <Link href={`/orgs/${orgSlug}/glossary/import`} className={cn(buttonVariants({ variant: "outline" }))}>
          CSVインポート
        </Link>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {info}
        </p>
      ) : null}

      <form action={createGlossaryTermAction.bind(null, orgSlug)} className="space-y-4 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">用語を追加</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="term" className="text-sm font-medium">
              term（正式表記）*
            </label>
            <input
              id="term"
              name="term"
              required
              placeholder="AAV"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reading" className="text-sm font-medium">
              読み
            </label>
            <input
              id="reading"
              name="reading"
              placeholder="エーエーブイ"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="pronunciationVariants" className="text-sm font-medium">
              発音バリエーション（カンマ区切り）
            </label>
            <input
              id="pronunciationVariants"
              name="pronunciationVariants"
              placeholder="エーブイ, ダブルエー"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="fullForm" className="text-sm font-medium">
              正式名称
            </label>
            <input
              id="fullForm"
              name="fullForm"
              placeholder="アデノ随伴ウイルス (Adeno-Associated Virus)"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="category" className="text-sm font-medium">
              カテゴリ
            </label>
            <select
              id="category"
              name="category"
              defaultValue=""
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">未設定</option>
              {GLOSSARY_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="definition" className="text-sm font-medium">
              定義
            </label>
            <textarea
              id="definition"
              name="definition"
              rows={2}
              placeholder="遺伝子治療で用いられるベクター"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="detailedExplanation" className="text-sm font-medium">
              詳細解説
            </label>
            <textarea
              id="detailedExplanation"
              name="detailedExplanation"
              rows={4}
              placeholder="新人向けの背景知識を含む説明"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="aliases" className="text-sm font-medium">
              別名・別表記（カンマ区切り）
            </label>
            <input
              id="aliases"
              name="aliases"
              placeholder="AAV2, AAV9"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <Button type="submit">用語を追加</Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">登録済み用語（{terms.length}件）</h2>
        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">用語はまだ登録されていません。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">用語</th>
                  <th className="px-3 py-2 font-medium">読み / カテゴリ</th>
                  <th className="px-3 py-2 font-medium">発音バリエーション</th>
                  <th className="px-3 py-2 font-medium">定義</th>
                  <th className="px-3 py-2 font-medium">統計</th>
                  <th className="px-3 py-2 font-medium">更新</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((term) => (
                  <tr key={term.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <Link href={`/orgs/${orgSlug}/glossary/${term.id}`} className="font-medium underline">
                        {term.term}
                      </Link>
                      {term.full_form ? (
                        <p className="mt-1 text-xs text-muted-foreground">{term.full_form}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <p>{term.reading ?? "-"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{term.category ?? "未設定"}</p>
                    </td>
                    <td className="px-3 py-2">
                      {(term.pronunciation_variants ?? []).length > 0
                        ? (term.pronunciation_variants ?? []).join(", ")
                        : "-"}
                      {(term.aliases ?? []).length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          別名: {(term.aliases ?? []).join(", ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{term.definition ?? "-"}</td>
                    <td className="px-3 py-2">
                      <p>出現: {term.occurrence_count}</p>
                      <p className="mt-1 text-xs text-muted-foreground">訂正: {term.correction_count}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(term.updated_at).toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
