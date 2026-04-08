import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function MembersPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="メンバー管理"
      description="Phase 2 で招待フロー・権限管理を実装します。"
      orgSlug={orgSlug}
    />
  );
}
