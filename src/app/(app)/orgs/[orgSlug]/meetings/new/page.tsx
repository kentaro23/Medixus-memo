import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function NewMeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="新規ミーティング"
      description="録音アップロードとリアルタイム文字起こし導線をここに実装します（Phase 4/7）。"
      orgSlug={orgSlug}
    />
  );
}
