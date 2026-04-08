import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  GLOSSARY_CATEGORY_OPTIONS,
  formatListInput,
  parseListInput,
  toNullableText,
} from "@/lib/glossary";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

type Params = { orgSlug: string; termId: string };
type SearchParams = Record<string, string | string[] | undefined>;

type GlossaryTermDetailRow = {
  id: string;
  term: string;
  reading: string | null;
  pronunciation_variants: string[] | null;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  category: string | null;
  aliases: string[] | null;
  occurrence_count: number;
  correction_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function redirectWithTermMessage(
  orgSlug: string,
  termId: string,
  key: string,
  message: string,
): never {
  return redirect(`/orgs/${orgSlug}/glossary/${termId}?${key}=${encodeURIComponent(message)}`);
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

async function updateGlossaryTermAction(orgSlug: string, termId: string, formData: FormData) {
  "use server";

  const nextPath = `/orgs/${orgSlug}/glossary/${termId}`;
  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const term = normalizeText(formData.get("term"));
  if (!term) {
    redirectWithTermMessage(orgSlug, termId, "error", "term（用語）は必須です。");
  }

  const reading = toNullableText(normalizeText(formData.get("reading")));
  const pronunciationVariants = parseListInput(normalizeText(formData.get("pronunciationVariants")));
  const fullForm = toNullableText(normalizeText(formData.get("fullForm")));
  const category = toNullableText(normalizeText(formData.get("category")));
  const definition = toNullableText(normalizeText(formData.get("definition")));
  const detailedExplanation = toNullableText(normalizeText(formData.get("detailedExplanation")));
  const aliases = parseListInput(normalizeText(formData.get("aliases")));

  const { error: updateError } = await supabase
    .from("glossary_terms")
    .update({
      term,
      reading,
      pronunciation_variants: pronunciationVariants,
      definition,
      detailed_explanation: detailedExplanation,
      full_form: fullForm,
      category,
      aliases,
    })
    .eq("id", termId)
    .eq("organization_id", organization.id);

  if (updateError) {
    if (updateError.code === "23505") {
      redirectWithTermMessage(orgSlug, termId, "error", "同じtermが既に存在します。");
    }
    redirectWithTermMessage(orgSlug, termId, "error", `更新に失敗しました: ${updateError.message}`);
  }

  redirectWithTermMessage(orgSlug, termId, "success", "用語を更新しました。");
}

async function deleteGlossaryTermAction(orgSlug: string, termId: string) {
  "use server";

  const nextPath = `/orgs/${orgSlug}/glossary/${termId}`;
  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { error: deleteError } = await supabase
    .from("glossary_terms")
    .delete()
    .eq("id", termId)
    .eq("organization_id", organization.id);

  if (deleteError) {
    redirectWithTermMessage(orgSlug, termId, "error", `削除に失敗しました: ${deleteError.message}`);
  }

  redirect(`/orgs/${orgSlug}/glossary?success=${encodeURIComponent("用語を削除しました。")}`);
}

export default async function GlossaryTermPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug, termId } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);
  const nextPath = `/orgs/${orgSlug}/glossary/${termId}`;

  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { data: glossaryTerm } = await supabase
    .from("glossary_terms")
    .select(
      "id, term, reading, pronunciation_variants, definition, detailed_explanation, full_form, category, aliases, occurrence_count, correction_count, last_used_at, created_at, updated_at",
    )
    .eq("organization_id", organization.id)
    .eq("id", termId)
    .maybeSingle<GlossaryTermDetailRow>();

  if (!glossaryTerm) {
    notFound();
  }

  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";
  const success = typeof parsedSearchParams.success === "string" ? parsedSearchParams.success : "";
  const info = typeof parsedSearchParams.info === "string" ? parsedSearchParams.info : "";

  return (
    <PageShell
      title={`用語詳細: ${glossaryTerm.term}`}
      description="用語情報を更新すると、議事録生成や発音学習に反映されます。"
      orgSlug={orgSlug}
    >
      <div className="flex gap-2">
        <Link href={`/orgs/${orgSlug}/glossary`} className={cn(buttonVariants({ variant: "outline" }))}>
          用語一覧へ戻る
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

      <form action={updateGlossaryTermAction.bind(null, orgSlug, termId)} className="space-y-4 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">編集</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="term" className="text-sm font-medium">
              term（正式表記）*
            </label>
            <input
              id="term"
              name="term"
              required
              defaultValue={glossaryTerm.term}
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
              defaultValue={glossaryTerm.reading ?? ""}
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
              defaultValue={formatListInput(glossaryTerm.pronunciation_variants)}
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
              defaultValue={glossaryTerm.full_form ?? ""}
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
              defaultValue={glossaryTerm.category ?? ""}
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
              defaultValue={glossaryTerm.definition ?? ""}
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
              rows={5}
              defaultValue={glossaryTerm.detailed_explanation ?? ""}
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
              defaultValue={formatListInput(glossaryTerm.aliases)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">更新する</Button>
        </div>
      </form>

      <form action={deleteGlossaryTermAction.bind(null, orgSlug, termId)} className="rounded-lg border p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          不要な用語は削除できます。削除権限がない場合はエラーが表示されます。
        </p>
        <Button type="submit" variant="destructive">
          この用語を削除
        </Button>
      </form>

      <section className="space-y-2 rounded-lg border p-4 text-sm">
        <h2 className="font-semibold">学習統計</h2>
        <p>出現回数: {glossaryTerm.occurrence_count}</p>
        <p>訂正回数: {glossaryTerm.correction_count}</p>
        <p>最終利用: {glossaryTerm.last_used_at ? new Date(glossaryTerm.last_used_at).toLocaleString("ja-JP") : "-"}</p>
        <p>作成日時: {new Date(glossaryTerm.created_at).toLocaleString("ja-JP")}</p>
        <p>更新日時: {new Date(glossaryTerm.updated_at).toLocaleString("ja-JP")}</p>
      </section>
    </PageShell>
  );
}
