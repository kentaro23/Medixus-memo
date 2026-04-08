import Link from "next/link";

import { PageShell } from "@/components/app/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

type Params = { orgSlug: string };

type CorrectionRow = {
  id: string;
  meeting_id: string | null;
  glossary_term_id: string | null;
  wrong_text: string;
  correct_text: string;
  context: string | null;
  is_pronunciation_variant: boolean;
  context_keywords: string[] | null;
  apply_globally: boolean;
  created_by: string | null;
  created_at: string;
};

type MeetingSummary = {
  id: string;
  title: string;
};

type GlossarySummary = {
  id: string;
  term: string;
};

type ProfileSummary = {
  id: string;
  email: string;
  full_name: string | null;
};

export default async function CorrectionsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const nextPath = `/orgs/${orgSlug}/corrections`;

  const { supabase, organization } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { data: correctionRows } = await supabase
    .from("transcription_corrections")
    .select(
      "id, meeting_id, glossary_term_id, wrong_text, correct_text, context, is_pronunciation_variant, context_keywords, apply_globally, created_by, created_at",
    )
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(300);

  const corrections = (correctionRows ?? []) as CorrectionRow[];
  const meetingIds = Array.from(
    new Set(corrections.map((correction) => correction.meeting_id).filter((id): id is string => !!id)),
  );
  const glossaryIds = Array.from(
    new Set(
      corrections.map((correction) => correction.glossary_term_id).filter((id): id is string => !!id),
    ),
  );
  const creatorIds = Array.from(
    new Set(corrections.map((correction) => correction.created_by).filter((id): id is string => !!id)),
  );

  let meetingsMap = new Map<string, MeetingSummary>();
  if (meetingIds.length > 0) {
    const { data: meetings } = await supabase.from("meetings").select("id, title").in("id", meetingIds);
    meetingsMap = new Map(
      ((meetings ?? []) as MeetingSummary[]).map((meeting) => [meeting.id, meeting]),
    );
  }

  let glossaryMap = new Map<string, GlossarySummary>();
  if (glossaryIds.length > 0) {
    const { data: terms } = await supabase.from("glossary_terms").select("id, term").in("id", glossaryIds);
    glossaryMap = new Map(((terms ?? []) as GlossarySummary[]).map((term) => [term.id, term]));
  }

  let profileMap = new Map<string, ProfileSummary>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", creatorIds);
    profileMap = new Map(
      ((profiles ?? []) as ProfileSummary[]).map((profile) => [profile.id, profile]),
    );
  }

  return (
    <PageShell
      title="訂正履歴"
      description="誤変換の修正履歴と発音学習データを確認できます。"
      orgSlug={orgSlug}
    >
      <Link href={`/orgs/${orgSlug}`} className={cn(buttonVariants({ variant: "outline" }))}>
        ダッシュボードへ戻る
      </Link>

      {corrections.length === 0 ? (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          まだ訂正履歴はありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">作成日時</th>
                <th className="px-3 py-2 font-medium">誤変換 → 正解</th>
                <th className="px-3 py-2 font-medium">タイプ</th>
                <th className="px-3 py-2 font-medium">文脈キーワード</th>
                <th className="px-3 py-2 font-medium">会議</th>
                <th className="px-3 py-2 font-medium">辞書</th>
                <th className="px-3 py-2 font-medium">登録者</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((correction) => {
                const meeting = correction.meeting_id
                  ? meetingsMap.get(correction.meeting_id)
                  : undefined;
                const glossary = correction.glossary_term_id
                  ? glossaryMap.get(correction.glossary_term_id)
                  : undefined;
                const creator = correction.created_by
                  ? profileMap.get(correction.created_by)
                  : undefined;

                return (
                  <tr key={correction.id} className="border-t align-top">
                    <td className="px-3 py-2">{new Date(correction.created_at).toLocaleString("ja-JP")}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {correction.wrong_text} → {correction.correct_text}
                      </div>
                      {correction.context ? (
                        <p className="mt-1 max-w-md text-xs text-muted-foreground">{correction.context}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{correction.is_pronunciation_variant ? "発音違い" : "表記修正"}</div>
                      <div className="text-muted-foreground">
                        {correction.apply_globally ? "全体適用" : "会議限定"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {(correction.context_keywords ?? []).length > 0
                        ? (correction.context_keywords ?? []).join(", ")
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {meeting ? (
                        <Link
                          href={`/orgs/${orgSlug}/meetings/${meeting.id}/transcript`}
                          className="underline"
                        >
                          {meeting.title}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {glossary ? (
                        <Link
                          href={`/orgs/${orgSlug}/glossary/${glossary.id}`}
                          className="underline"
                        >
                          {glossary.term}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {creator ? creator.full_name || creator.email : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
