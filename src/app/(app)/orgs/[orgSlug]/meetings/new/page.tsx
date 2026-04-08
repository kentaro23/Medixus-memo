import { PageShell } from "@/components/app/page-shell";
import { NewMeetingForm } from "@/components/meeting/NewMeetingForm";
import { requireOrganizationContext } from "@/lib/org-context";

type Params = { orgSlug: string };
type OrganizationLlmRow = {
  default_llm: string;
};

export default async function NewMeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const nextPath = `/orgs/${orgSlug}/meetings/new`;

  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { data: orgSettings } = await supabase
    .from("organizations")
    .select("default_llm")
    .eq("id", organization.id)
    .maybeSingle<OrganizationLlmRow>();

  const defaultLlm =
    orgSettings?.default_llm === "gpt-4o" ? "gpt-4o" : "claude-sonnet-4-6";

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
