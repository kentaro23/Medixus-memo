import Link from "next/link";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { parseGlossaryCsv } from "@/lib/glossary";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

type Params = { orgSlug: string };
type SearchParams = Record<string, string | string[] | undefined>;

type ExistingTermRow = {
  term: string;
};

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithParams(orgSlug: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);
  return redirect(`/orgs/${orgSlug}/glossary/import?${searchParams.toString()}`);
}

function redirectWithError(orgSlug: string, message: string): never {
  return redirectWithParams(orgSlug, { error: message });
}

async function importGlossaryCsvAction(orgSlug: string, formData: FormData) {
  "use server";

  const nextPath = `/orgs/${orgSlug}/glossary/import`;
  const { supabase, organization, user } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const csvFile = formData.get("csvFile");
  const pastedCsv = normalizeText(formData.get("csvText"));
  let csvContent = "";

  if (csvFile instanceof File && csvFile.size > 0) {
    csvContent = (await csvFile.text()).trim();
  }

  if (!csvContent && pastedCsv) {
    csvContent = pastedCsv;
  }

  if (!csvContent) {
    redirectWithError(orgSlug, "CSVファイルを選択するか、CSVテキストを貼り付けてください。");
  }

  const parsed = parseGlossaryCsv(csvContent);
  if (parsed.error) {
    redirectWithError(orgSlug, parsed.error);
  }

  const termsInCsv = Array.from(new Set(parsed.rows.map((row) => row.term)));
  const { data: existingTerms, error: existingTermsError } = await supabase
    .from("glossary_terms")
    .select("term")
    .eq("organization_id", organization.id)
    .in("term", termsInCsv);

  if (existingTermsError) {
    redirectWithError(orgSlug, `既存データ確認に失敗しました: ${existingTermsError.message}`);
  }

  const existingSet = new Set((existingTerms ?? []).map((row: ExistingTermRow) => row.term));
  let insertedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let firstFailureMessage = "";

  for (const row of parsed.rows) {
    const updatePayload = {
      reading: row.reading,
      pronunciation_variants: row.pronunciationVariants,
      definition: row.definition,
      detailed_explanation: row.detailedExplanation,
      full_form: row.fullForm,
      category: row.category,
      aliases: row.aliases,
    };

    if (existingSet.has(row.term)) {
      const { error } = await supabase
        .from("glossary_terms")
        .update(updatePayload)
        .eq("organization_id", organization.id)
        .eq("term", row.term);

      if (error) {
        failedCount += 1;
        if (!firstFailureMessage) {
          firstFailureMessage = `${row.rowNumber}行目(${row.term}): ${error.message}`;
        }
      } else {
        updatedCount += 1;
      }
      continue;
    }

    const { error: insertError } = await supabase.from("glossary_terms").insert({
      organization_id: organization.id,
      term: row.term,
      created_by: user.id,
      ...updatePayload,
    });

    if (!insertError) {
      insertedCount += 1;
      existingSet.add(row.term);
      continue;
    }

    if (insertError.code === "23505") {
      const { error: retryUpdateError } = await supabase
        .from("glossary_terms")
        .update(updatePayload)
        .eq("organization_id", organization.id)
        .eq("term", row.term);

      if (retryUpdateError) {
        failedCount += 1;
        if (!firstFailureMessage) {
          firstFailureMessage = `${row.rowNumber}行目(${row.term}): ${retryUpdateError.message}`;
        }
      } else {
        updatedCount += 1;
        existingSet.add(row.term);
      }
      continue;
    }

    failedCount += 1;
    if (!firstFailureMessage) {
      firstFailureMessage = `${row.rowNumber}行目(${row.term}): ${insertError.message}`;
    }
  }

  const summary = `インポート完了: 追加${insertedCount}件 / 更新${updatedCount}件 / 失敗${failedCount}件`;

  if (failedCount > 0) {
    redirectWithParams(orgSlug, {
      info: summary,
      error: firstFailureMessage || "一部の行でエラーが発生しました。",
    });
  }

  redirectWithParams(orgSlug, { success: summary });
}

const CSV_TEMPLATE = `term,reading,pronunciation_variants,definition,detailed_explanation,full_form,category,aliases
AAV,エーエーブイ,"エーブイ,ダブルエー",遺伝子治療で用いられるベクター,アデノ随伴ウイルスは病原性が低く研究用途で広く使われる。,"アデノ随伴ウイルス (Adeno-Associated Virus)",略語,"AAV2,AAV9"
EYA1,イーワイエーワン,,BOR症候群に関連する遺伝子,耳鼻科領域の遺伝学カンファで頻出。,Eyes absent homolog 1,遺伝子,`;

export default async function GlossaryImportPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);
  const nextPath = `/orgs/${orgSlug}/glossary/import`;

  await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";
  const success = typeof parsedSearchParams.success === "string" ? parsedSearchParams.success : "";
  const info = typeof parsedSearchParams.info === "string" ? parsedSearchParams.info : "";

  return (
    <PageShell
      title="CSVインポート"
      description="辞書用語をCSVで一括登録・更新します。termが一致する行は上書き更新されます。"
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

      <form action={importGlossaryCsvAction.bind(null, orgSlug)} className="space-y-4 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">CSVアップロード</h2>

        <div className="space-y-2">
          <label htmlFor="csvFile" className="text-sm font-medium">
            CSVファイル
          </label>
          <input
            id="csvFile"
            name="csvFile"
            type="file"
            accept=".csv,text/csv"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            ファイル指定がある場合はファイルを優先します。
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="csvText" className="text-sm font-medium">
            CSVテキストを直接貼り付け（任意）
          </label>
          <textarea
            id="csvText"
            name="csvText"
            rows={10}
            placeholder={CSV_TEMPLATE}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>

        <Button type="submit">インポート実行</Button>
      </form>

      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">CSVフォーマット例</h2>
        <p className="text-xs text-muted-foreground">
          必須列は <code>term</code> のみです。ヘッダーは <code>term</code> または <code>用語</code>{" "}
          を認識します。
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted/30 p-3 text-xs">
          <code>{CSV_TEMPLATE}</code>
        </pre>
      </section>
    </PageShell>
  );
}
