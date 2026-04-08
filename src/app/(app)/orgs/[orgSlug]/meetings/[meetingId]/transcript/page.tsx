import { PageShell } from "@/components/app/page-shell";

type Params = { orgSlug: string; meetingId: string };

export default async function MeetingTranscriptPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug, meetingId } = await Promise.resolve(params);

  return (
    <PageShell
      title="文字起こし全文"
      description={`meetingId: ${meetingId} / Phase 5 で訂正UIを実装します。`}
      orgSlug={orgSlug}
    />
  );
}
