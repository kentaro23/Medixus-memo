import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function CorrectionsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="訂正履歴"
      description="Phase 5 で発音学習を含む訂正履歴一覧を実装します。"
      orgSlug={orgSlug}
    />
  );
}
