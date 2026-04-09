import { PageShell } from "@/components/app/page-shell";
import { LiveTranscriptionPanel } from "@/components/meeting/LiveTranscriptionPanel";
import { requireOrganizationContext } from "@/lib/org-context";

type Params = { orgSlug: string };

export default async function LiveMeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const nextPath = `/orgs/${orgSlug}/meetings/live`;

  const { organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const defaultLlm = "gpt-5.4";

  return (
    <PageShell
      title="リアルタイム文字起こし"
      description="マイク音声をリアルタイムで文字起こしし、終了時に議事録を自動生成します。"
      orgSlug={orgSlug}
    >
      <LiveTranscriptionPanel
        orgSlug={orgSlug}
        organizationId={organization.id}
        defaultLlm={defaultLlm}
      />
    </PageShell>
  );
}
