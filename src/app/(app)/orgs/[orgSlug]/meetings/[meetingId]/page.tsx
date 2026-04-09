import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MinutesRenderer } from "@/components/MinutesRenderer";
import { PageShell } from "@/components/app/page-shell";
import { CommentSidebar } from "@/components/comments/CommentSidebar";
import { UncertainTermReviewCard } from "@/components/meeting/UncertainTermReviewCard";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  generateMinutesForMeeting,
  transcribeMeeting,
  type MinutesDetailMode,
} from "@/lib/meeting-pipeline";
import { requireOrganizationContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { orgSlug: string; meetingId: string };
type SearchParams = Record<string, string | string[] | undefined>;

type MeetingDetailRow = {
  id: string;
  organization_id: string;
  title: string;
  status: "pending" | "transcribing" | "generating" | "completed" | "failed";
  meeting_date: string | null;
  audio_url: string | null;
  llm_used: string | null;
  raw_transcript: string | null;
  corrected_transcript: string | null;
  minutes_markdown: string | null;
  new_term_candidates: unknown;
  created_at: string;
  updated_at: string;
};

type GlossaryLookupRow = {
  id: string;
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  pronunciation_variants: string[] | null;
};

type NewTermCandidate = {
  term: string;
  guess_full_form: string | null;
  guess_definition: string | null;
  guess_category: string | null;
  review_needed: boolean;
  heard_text: string | null;
  context_excerpt: string | null;
  question: string | null;
};

type ExistingTermRow = {
  id: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  category: string | null;
};

function redirectWithMessage(
  orgSlug: string,
  meetingId: string,
  key: string,
  message: string,
): never {
  return redirect(
    `/orgs/${orgSlug}/meetings/${meetingId}?${key}=${encodeURIComponent(message)}`,
  );
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMinutesDetailMode(value: FormDataEntryValue | null): MinutesDetailMode {
  return value === "detailed" ? "detailed" : "standard";
}

function parseNewTermCandidates(raw: unknown): NewTermCandidate[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((candidate) => {
      const row =
        candidate && typeof candidate === "object"
          ? (candidate as Record<string, unknown>)
          : {};
      const term = typeof row.term === "string" ? row.term.trim() : "";
      if (!term) {
        return null;
      }
      return {
        term,
        guess_full_form:
          typeof row.guess_full_form === "string" && row.guess_full_form.trim()
            ? row.guess_full_form.trim()
            : null,
        guess_definition:
          typeof row.guess_definition === "string" && row.guess_definition.trim()
            ? row.guess_definition.trim()
            : null,
        guess_category:
          typeof row.guess_category === "string" && row.guess_category.trim()
            ? row.guess_category.trim()
            : null,
        review_needed: row.review_needed === true,
        heard_text:
          typeof row.heard_text === "string" && row.heard_text.trim() ? row.heard_text.trim() : null,
        context_excerpt:
          typeof row.context_excerpt === "string" && row.context_excerpt.trim()
            ? row.context_excerpt.trim()
            : null,
        question:
          typeof row.question === "string" && row.question.trim() ? row.question.trim() : null,
      };
    })
    .filter((candidate): candidate is NewTermCandidate => Boolean(candidate));
}

function extractBlockIds(markdown: string | null) {
  if (!markdown) {
    return [] as string[];
  }

  const regex = /<!--\s*block:([a-zA-Z0-9_-]+)\s*-->/g;
  const ids: string[] = [];
  let match = regex.exec(markdown);
  while (match) {
    ids.push(match[1]);
    match = regex.exec(markdown);
  }

  return Array.from(new Set(ids));
}

function statusLabel(status: MeetingDetailRow["status"]) {
  switch (status) {
    case "pending":
      return "未処理";
    case "transcribing":
      return "文字起こし中";
    case "generating":
      return "議事録生成中";
    case "completed":
      return "完了";
    case "failed":
      return "失敗";
    default:
      return status;
  }
}

function formatTranscriptionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("maximum content size limit") ||
    normalized.includes("content size limit") ||
    normalized.includes("status code 413") ||
    normalized.includes(" 413:")
  ) {
    return "音声サイズがWhisper上限を超えました。24MB以下に圧縮または分割して再実行してください。";
  }

  return `処理に失敗しました: ${message}`;
}

async function loadMeetingForOrg(orgSlug: string, meetingId: string) {
  const nextPath = `/orgs/${orgSlug}/meetings/${meetingId}`;
  const { supabase, organization, user } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, organization_id, title, status, meeting_date, audio_url, llm_used, raw_transcript, corrected_transcript, minutes_markdown, new_term_candidates, created_at, updated_at",
    )
    .eq("organization_id", organization.id)
    .eq("id", meetingId)
    .maybeSingle<MeetingDetailRow>();

  if (!meeting) {
    notFound();
  }

  return { supabase, organization, user, meeting };
}

async function startTranscriptionAction(orgSlug: string, meetingId: string, formData: FormData) {
  "use server";

  const { meeting } = await loadMeetingForOrg(orgSlug, meetingId);
  const detailMode = normalizeMinutesDetailMode(formData.get("detailMode"));

  if (!meeting.audio_url) {
    redirectWithMessage(orgSlug, meetingId, "error", "音声ファイルが未登録です。");
  }

  try {
    await transcribeMeeting(meetingId, { detailMode });
  } catch (error) {
    redirectWithMessage(orgSlug, meetingId, "error", formatTranscriptionError(error));
  }

  redirectWithMessage(
    orgSlug,
    meetingId,
    "success",
    detailMode === "detailed"
      ? "文字起こしと議事録生成（詳細モード）が完了しました。"
      : "文字起こしと議事録生成が完了しました。",
  );
}

async function regenerateMinutesAction(orgSlug: string, meetingId: string, formData: FormData) {
  "use server";

  const { supabase, meeting } = await loadMeetingForOrg(orgSlug, meetingId);
  const detailMode = normalizeMinutesDetailMode(formData.get("detailMode"));

  if (!meeting.corrected_transcript) {
    redirectWithMessage(
      orgSlug,
      meetingId,
      "error",
      "文字起こしデータがないため再生成できません。",
    );
  }

  await supabase.from("meetings").update({ status: "generating" }).eq("id", meetingId);

  try {
    await generateMinutesForMeeting(meetingId, { detailMode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    redirectWithMessage(orgSlug, meetingId, "error", `議事録再生成に失敗しました: ${message}`);
  }

  redirectWithMessage(
    orgSlug,
    meetingId,
    "success",
    detailMode === "detailed"
      ? "議事録を詳細モードで再生成しました。"
      : "議事録を再生成しました。",
  );
}

async function addCandidateToGlossaryAction(orgSlug: string, meetingId: string, formData: FormData) {
  "use server";

  const { supabase, organization, user, meeting } = await loadMeetingForOrg(orgSlug, meetingId);

  const term = normalizeText(formData.get("term"));
  const guessFullForm = normalizeText(formData.get("guessFullForm"));
  const guessDefinition = normalizeText(formData.get("guessDefinition"));
  const guessCategory = normalizeText(formData.get("guessCategory"));

  if (!term) {
    redirectWithMessage(orgSlug, meetingId, "error", "候補用語が不正です。");
  }

  const { data: existingTerm } = await supabase
    .from("glossary_terms")
    .select("id, definition, detailed_explanation, full_form, category")
    .eq("organization_id", organization.id)
    .eq("term", term)
    .maybeSingle<ExistingTermRow>();

  if (existingTerm) {
    const updates: Record<string, string> = {};

    if (guessDefinition && !existingTerm.definition) {
      updates.definition = guessDefinition;
    }
    if (guessFullForm && !existingTerm.full_form) {
      updates.full_form = guessFullForm;
    }
    if (guessCategory && !existingTerm.category) {
      updates.category = guessCategory;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from("glossary_terms").update(updates).eq("id", existingTerm.id);
    }
  } else {
    const { error: insertError } = await supabase.from("glossary_terms").insert({
      organization_id: organization.id,
      term,
      full_form: guessFullForm || null,
      definition: guessDefinition || null,
      category: guessCategory || null,
      created_by: user.id,
    });

    if (insertError) {
      redirectWithMessage(orgSlug, meetingId, "error", `辞書追加に失敗しました: ${insertError.message}`);
    }
  }

  const candidates = parseNewTermCandidates(meeting.new_term_candidates);
  const remainingCandidates = candidates.filter((candidate) => candidate.term !== term);
  await supabase
    .from("meetings")
    .update({ new_term_candidates: remainingCandidates })
    .eq("id", meetingId);

  redirectWithMessage(orgSlug, meetingId, "success", `「${term}」を辞書に追加しました。`);
}

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug, meetingId } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);

  const { supabase, meeting } = await loadMeetingForOrg(orgSlug, meetingId);

  const { data: glossaryTerms } = await supabase
    .from("glossary_terms")
    .select("id, term, definition, detailed_explanation, full_form, pronunciation_variants")
    .eq("organization_id", meeting.organization_id)
    .order("occurrence_count", { ascending: false })
    .limit(300);

  const terms = (glossaryTerms ?? []) as GlossaryLookupRow[];
  const newTermCandidates = parseNewTermCandidates(meeting.new_term_candidates);
  const blockIds = extractBlockIds(meeting.minutes_markdown);

  const message = typeof parsedSearchParams.message === "string" ? parsedSearchParams.message : "";
  const success = typeof parsedSearchParams.success === "string" ? parsedSearchParams.success : "";
  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";

  return (
    <PageShell
      title={meeting.title}
      description={`会議ID: ${meeting.id}`}
      orgSlug={orgSlug}
    >
      <div className="flex flex-wrap gap-2">
        <Link href={`/orgs/${orgSlug}`} className={cn(buttonVariants({ variant: "outline" }))}>
          ダッシュボードへ戻る
        </Link>
        <Link
          href={`/orgs/${orgSlug}/meetings/${meetingId}/transcript`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          文字起こし全文
        </Link>
        <Link
          href={`/api/meetings/${meetingId}/export?format=markdown`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Markdown出力
        </Link>
        <Link
          href={`/api/meetings/${meetingId}/export?format=pdf`}
          target="_blank"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          PDF出力
        </Link>
      </div>

      {message ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border p-4 text-sm">
        <h2 className="font-semibold">処理状態</h2>
        <p>
          ステータス: <span className="font-medium">{statusLabel(meeting.status)}</span>
        </p>
        <p>LLM: {meeting.llm_used ?? "未指定"}</p>
        <p>開催日時: {meeting.meeting_date ? new Date(meeting.meeting_date).toLocaleString("ja-JP") : "-"}</p>
        <p>作成日時: {new Date(meeting.created_at).toLocaleString("ja-JP")}</p>
        <p>更新日時: {new Date(meeting.updated_at).toLocaleString("ja-JP")}</p>

        <div className="flex flex-wrap gap-2 pt-2">
          {meeting.audio_url ? (
            <form action={startTranscriptionAction.bind(null, orgSlug, meetingId)}>
              <div className="mb-2">
                <select
                  name="detailMode"
                  defaultValue="standard"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="standard">標準モード</option>
                  <option value="detailed">詳細モード（より細かく記述）</option>
                </select>
              </div>
              <Button type="submit" disabled={meeting.status === "transcribing" || meeting.status === "generating"}>
                文字起こしを開始
              </Button>
            </form>
          ) : null}

          {meeting.corrected_transcript ? (
            <form action={regenerateMinutesAction.bind(null, orgSlug, meetingId)}>
              <div className="mb-2">
                <select
                  name="detailMode"
                  defaultValue="standard"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="standard">標準モード</option>
                  <option value="detailed">詳細モード（より細かく記述）</option>
                </select>
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={meeting.status === "transcribing" || meeting.status === "generating"}
              >
                議事録を再生成
              </Button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">議事録本文</h2>
          {meeting.minutes_markdown ? (
            <MinutesRenderer
              markdown={meeting.minutes_markdown}
              glossaryTerms={terms}
              orgSlug={orgSlug}
              meetingId={meeting.id}
              organizationId={meeting.organization_id}
            />
          ) : (
            <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              まだ議事録は生成されていません。
            </p>
          )}
        </div>

        <CommentSidebar
          organizationId={meeting.organization_id}
          meetingId={meeting.id}
          blockIds={blockIds}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">新出用語候補</h2>
        {newTermCandidates.length === 0 ? (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
            新出用語候補はありません。
          </p>
        ) : (
          <div className="space-y-3">
            {newTermCandidates.map((candidate) => (
              candidate.review_needed ? (
                <UncertainTermReviewCard
                  key={`${candidate.term}-${candidate.heard_text ?? ""}`}
                  organizationId={meeting.organization_id}
                  meetingId={meeting.id}
                  candidate={candidate}
                />
              ) : (
                <form
                  key={candidate.term}
                  action={addCandidateToGlossaryAction.bind(null, orgSlug, meetingId)}
                  className="rounded-lg border p-3 text-sm"
                >
                  <input type="hidden" name="term" value={candidate.term} />
                  <input type="hidden" name="guessFullForm" value={candidate.guess_full_form ?? ""} />
                  <input type="hidden" name="guessDefinition" value={candidate.guess_definition ?? ""} />
                  <input type="hidden" name="guessCategory" value={candidate.guess_category ?? ""} />

                  <p className="font-medium">{candidate.term}</p>
                  {candidate.guess_full_form ? (
                    <p className="text-xs text-muted-foreground">{candidate.guess_full_form}</p>
                  ) : null}
                  {candidate.guess_definition ? <p className="mt-1">{candidate.guess_definition}</p> : null}
                  {candidate.guess_category ? (
                    <p className="mt-1 text-xs text-muted-foreground">カテゴリ推定: {candidate.guess_category}</p>
                  ) : null}

                  <div className="mt-3">
                    <Button type="submit" variant="outline">
                      辞書に追加
                    </Button>
                  </div>
                </form>
              )
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
