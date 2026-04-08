import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string; meetingId: string };

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug, meetingId } = await Promise.resolve(params);

  return (
    <PageShell
      title="議事録詳細"
      description={`meetingId: ${meetingId} / Phase 4 で MinutesRenderer + CommentSidebar を実装します。`}
      orgSlug={orgSlug}
    />
  );
}
