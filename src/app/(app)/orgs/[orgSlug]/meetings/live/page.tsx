import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string };

export default async function LiveMeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);

  return (
    <PageShell
      title="リアルタイム文字起こし"
      description="Phase 7 で OpenAI Realtime API の接続とライブ表示を実装します。"
      orgSlug={orgSlug}
    />
  );
}
