import Link from "next/link";

import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function SettingsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell title="設定" description="組織設定・LLM選択の画面です。" orgSlug={orgSlug}>
      <Link href={`/orgs/${orgSlug}/settings/members`} className="text-sm underline">
        メンバー管理へ
      </Link>
    </PageShell>
  );
}
