import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function GlossaryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="用語辞書"
      description="Phase 3 で CRUD・発音バリエーション入力・検索を実装します。"
      orgSlug={orgSlug}
    />
  );
}
