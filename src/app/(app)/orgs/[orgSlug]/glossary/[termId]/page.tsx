import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string; termId: string };

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug, termId } = await Promise.resolve(params);

  return (
    <PageShell
      title="用語詳細"
      description={`termId: ${termId} / 用語編集フォームは Phase 3 で実装します。`}
      orgSlug={orgSlug}
    />
  );
}
