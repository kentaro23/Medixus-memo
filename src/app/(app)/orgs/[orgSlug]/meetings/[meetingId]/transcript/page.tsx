import Link from "next/link";
import { notFound } from "next/navigation";

import { TranscriptCorrectionPanel } from "@/components/corrections/TranscriptCorrectionPanel";
import { PageShell } from "@/components/app/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

type Params = { orgSlug: string; meetingId: string };

type TranscriptMeetingRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  raw_transcript: string | null;
  corrected_transcript: string | null;
  updated_at: string;
};

export default async function MeetingTranscriptPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug, meetingId } = await Promise.resolve(params);
  const nextPath = `/orgs/${orgSlug}/meetings/${meetingId}/transcript`;

  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, organization_id, title, status, raw_transcript, corrected_transcript, updated_at")
    .eq("organization_id", organization.id)
    .eq("id", meetingId)
    .maybeSingle<TranscriptMeetingRow>();

  if (!meeting) {
    notFound();
  }

  return (
    <PageShell
      title="文字起こし全文"
      description={`${meeting.title} / 最終更新: ${new Date(meeting.updated_at).toLocaleString("ja-JP")}`}
      orgSlug={orgSlug}
    >
      <Link
        href={`/orgs/${orgSlug}/meetings/${meetingId}`}
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        議事録詳細へ戻る
      </Link>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Whisper生出力</h2>
        <textarea
          readOnly
          value={meeting.raw_transcript ?? ""}
          className="min-h-64 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">訂正適用後</h2>
        <textarea
          readOnly
          value={meeting.corrected_transcript ?? ""}
          className="min-h-64 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </section>

      <TranscriptCorrectionPanel
        organizationId={organization.id}
        meetingId={meetingId}
        correctedTranscript={meeting.corrected_transcript ?? ""}
      />
    </PageShell>
  );
}
