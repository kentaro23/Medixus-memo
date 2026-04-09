import Link from "next/link";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { requireOrganizationContext } from "@/lib/org-context";

type Params = {
  orgSlug: string;
};
type SearchParams = Record<string, string | string[] | undefined>;

type MeetingSummary = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  audio_url: string | null;
};

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithStatus(orgSlug: string, key: "message" | "error", value: string): never {
  return redirect(`/orgs/${orgSlug}?${key}=${encodeURIComponent(value)}`);
}

function isIgnorableStorageDeleteError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not found") ||
    normalized.includes("no rows") ||
    normalized.includes("already") ||
    normalized.includes("does not exist")
  );
}

async function deleteMeetingAction(orgSlug: string, formData: FormData) {
  "use server";

  const meetingId = normalizeText(formData.get("meetingId"));
  if (!meetingId) {
    redirectWithStatus(orgSlug, "error", "削除対象の議事録IDが不正です。");
  }

  const { supabase, organization, membership } = await requireOrganizationContext({
    orgSlug,
    nextPath: `/orgs/${orgSlug}`,
  });

  if (membership.role === "member") {
    redirectWithStatus(orgSlug, "error", "議事録削除は owner/admin のみ実行できます。");
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, audio_url")
    .eq("organization_id", organization.id)
    .eq("id", meetingId)
    .maybeSingle<{ id: string; title: string; audio_url: string | null }>();

  if (!meeting) {
    redirectWithStatus(orgSlug, "error", "議事録が見つかりません。");
  }

  if (meeting.audio_url) {
    const { error: storageDeleteError } = await supabase.storage
      .from("audio")
      .remove([meeting.audio_url]);

    if (storageDeleteError && !isIgnorableStorageDeleteError(storageDeleteError.message)) {
      redirectWithStatus(
        orgSlug,
        "error",
        `音声ファイル削除に失敗しました: ${storageDeleteError.message}`,
      );
    }
  }

  const { error: deleteMeetingError } = await supabase
    .from("meetings")
    .delete()
    .eq("organization_id", organization.id)
    .eq("id", meeting.id);

  if (deleteMeetingError) {
    redirectWithStatus(orgSlug, "error", `議事録削除に失敗しました: ${deleteMeetingError.message}`);
  }

  redirectWithStatus(orgSlug, "message", `「${meeting.title}」を完全削除しました。`);
}

export default async function OrganizationDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);
  const { supabase, organization, membership } = await requireOrganizationContext({
    orgSlug,
    nextPath: `/orgs/${orgSlug}`,
  });

  const { data: orgSettings } = await supabase
    .from("organizations")
    .select("default_llm")
    .eq("id", organization.id)
    .maybeSingle<{ default_llm: string }>();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, status, created_at, audio_url")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const message = typeof parsedSearchParams.message === "string" ? parsedSearchParams.message : "";
  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";

  return (
    <PageShell
      title={`${organization.name} ダッシュボード`}
      description={`既定LLM: ${orgSettings?.default_llm ?? "未設定"}`}
      orgSlug={organization.slug}
    >
      {message ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Link href={`/orgs/${orgSlug}/meetings/new`} className="rounded-md border p-3 hover:bg-muted">
          新規議事録を作成
        </Link>
        <Link href={`/orgs/${orgSlug}/meetings/live`} className="rounded-md border p-3 hover:bg-muted">
          ライブ文字起こし
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
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/orgs/${orgSlug}/meetings/${meeting.id}`} className="font-medium underline">
                      {meeting.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      status: {meeting.status} / {new Date(meeting.created_at).toLocaleString("ja-JP")}
                    </p>
                  </div>

                  {membership.role === "owner" || membership.role === "admin" ? (
                    <form action={deleteMeetingAction.bind(null, orgSlug)}>
                      <input type="hidden" name="meetingId" value={meeting.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        完全削除
                      </Button>
                    </form>
                  ) : null}
                </div>
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
