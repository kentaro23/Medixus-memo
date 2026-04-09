import { PageShell } from "@/components/app/page-shell";
import { NewMeetingForm } from "@/components/meeting/NewMeetingForm";
import { requireOrganizationContext } from "@/lib/org-context";

type Params = { orgSlug: string };

export default async function NewMeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const nextPath = `/orgs/${orgSlug}/meetings/new`;

  const { organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const defaultLlm = "gpt-5.4";

  return (
    <PageShell
      title="新規ミーティング"
      description="音声ファイルをアップロードして、Whisper文字起こしと議事録生成を実行します。"
      orgSlug={orgSlug}
    >
      <NewMeetingForm orgSlug={orgSlug} organizationId={organization.id} defaultLlm={defaultLlm} />
    </PageShell>
  );
}
