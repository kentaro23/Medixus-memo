import Link from "next/link";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { createClient } from "@/lib/supabase/server";

type Params = {
  orgSlug: string;
};

type MeetingSummary = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

export default async function OrganizationDashboardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const supabase = await createClient();

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug, default_llm")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!organization) {
    notFound();
  }

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, status, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <PageShell
      title={`${organization.name} ダッシュボード`}
      description={`既定LLM: ${organization.default_llm}`}
      orgSlug={organization.slug}
    >
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Link href={`/orgs/${orgSlug}/meetings/new`} className="rounded-md border p-3 hover:bg-muted">
          新規議事録を作成
        </Link>
        <Link href={`/orgs/${orgSlug}/glossary`} className="rounded-md border p-3 hover:bg-muted">
          用語辞書を管理
        </Link>
        <Link href={`/orgs/${orgSlug}/corrections`} className="rounded-md border p-3 hover:bg-muted">
          訂正履歴を見る
        </Link>
        <Link href={`/orgs/${orgSlug}/settings`} className="rounded-md border p-3 hover:bg-muted">
          設定を開く
        </Link>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">最近の議事録</h2>
        {(meetings as MeetingSummary[] | null)?.length ? (
          <ul className="space-y-2">
            {(meetings as MeetingSummary[]).map((meeting) => (
              <li key={meeting.id} className="rounded-md border p-3 text-sm">
                <Link href={`/orgs/${orgSlug}/meetings/${meeting.id}`} className="font-medium underline">
                  {meeting.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  status: {meeting.status} / {new Date(meeting.created_at).toLocaleString("ja-JP")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">議事録はまだありません。</p>
        )}
      </div>
    </PageShell>
  );
}
