import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function GlossaryImportPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="CSVインポート"
      description="Phase 3 で辞書CSVの検証と一括登録を実装します。"
      orgSlug={orgSlug}
    />
  );
}
