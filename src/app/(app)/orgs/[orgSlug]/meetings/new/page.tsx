import { redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { requireOrganizationContext } from "@/lib/org-context";

type Params = { orgSlug: string };
type SearchParams = Record<string, string | string[] | undefined>;

type NewMeetingRow = {
  id: string;
};

type OrganizationLlmRow = {
  default_llm: string;
};

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function toMeetingIsoDate(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function sanitizeFilename(filename: string) {
  const normalized = filename.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return normalized.length > 0 ? normalized : "audio-file";
}

function isAllowedLlm(value: string) {
  return value === "claude-sonnet-4-6" || value === "gpt-4o";
}

function redirectWithError(orgSlug: string, message: string): never {
  return redirect(`/orgs/${orgSlug}/meetings/new?error=${encodeURIComponent(message)}`);
}

async function createMeetingAction(orgSlug: string, formData: FormData) {
  "use server";

  const nextPath = `/orgs/${orgSlug}/meetings/new`;
  const { supabase, organization, user } = await requireOrganizationContext({
    orgSlug,
    nextPath,
  });

  const title = normalizeText(formData.get("title"));
  if (!title) {
    redirectWithError(orgSlug, "会議タイトルは必須です。");
  }

  const llmInput = normalizeText(formData.get("llmUsed"));
  const llmUsed = isAllowedLlm(llmInput) ? llmInput : "claude-sonnet-4-6";
  const meetingDateIso = toMeetingIsoDate(normalizeText(formData.get("meetingDate")));

  const audioFile = formData.get("audioFile");
  if (!(audioFile instanceof File) || audioFile.size <= 0) {
    redirectWithError(orgSlug, "音声ファイルを選択してください。");
  }

  const { data: createdMeeting, error: createMeetingError } = await supabase
    .from("meetings")
    .insert({
      organization_id: organization.id,
      title,
      meeting_date: meetingDateIso,
      llm_used: llmUsed,
      status: "pending",
      created_by: user.id,
    })
    .select("id")
    .single<NewMeetingRow>();

  if (createMeetingError || !createdMeeting) {
    redirectWithError(orgSlug, `会議作成に失敗しました: ${createMeetingError?.message}`);
  }

  const originalName = sanitizeFilename(audioFile.name || "audio.wav");
  const safeFilename = originalName.includes(".")
    ? `${Date.now()}-${originalName}`
    : `${Date.now()}-${originalName}.wav`;
  const storagePath = `${organization.id}/${createdMeeting.id}/${safeFilename}`;

  const { error: uploadError } = await supabase.storage
    .from("audio")
    .upload(storagePath, audioFile, {
      contentType: audioFile.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    await supabase.from("meetings").delete().eq("id", createdMeeting.id);
    redirectWithError(orgSlug, `音声アップロードに失敗しました: ${uploadError.message}`);
  }

  const { error: updateMeetingError } = await supabase
    .from("meetings")
    .update({ audio_url: storagePath })
    .eq("id", createdMeeting.id);

  if (updateMeetingError) {
    await supabase.storage.from("audio").remove([storagePath]);
    await supabase.from("meetings").delete().eq("id", createdMeeting.id);
    redirectWithError(orgSlug, `会議データ更新に失敗しました: ${updateMeetingError.message}`);
  }

  redirect(
    `/orgs/${orgSlug}/meetings/${createdMeeting.id}?message=${encodeURIComponent(
      "音声アップロードが完了しました。文字起こしを開始してください。",
    )}`,
  );
}

export default async function NewMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);
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
  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";

  return (
    <PageShell
      title="新規ミーティング"
      description="音声ファイルをアップロードして、Whisper文字起こしと議事録生成を実行します。"
      orgSlug={orgSlug}
    >
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form action={createMeetingAction.bind(null, orgSlug)} className="space-y-4 rounded-lg border p-4">
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            会議タイトル *
          </label>
          <input
            id="title"
            name="title"
            required
            placeholder="第12回 耳鼻科ラボミーティング"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="meetingDate" className="text-sm font-medium">
              開催日時（任意）
            </label>
            <input
              id="meetingDate"
              name="meetingDate"
              type="datetime-local"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="llmUsed" className="text-sm font-medium">
              議事録生成LLM
            </label>
            <select
              id="llmUsed"
              name="llmUsed"
              defaultValue={defaultLlm}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="audioFile" className="text-sm font-medium">
            音声ファイル *
          </label>
          <input
            id="audioFile"
            name="audioFile"
            type="file"
            accept="audio/*"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            対応例: mp3, m4a, wav。アップロード後に詳細画面で文字起こしを開始します。
          </p>
        </div>

        <Button type="submit">保存して詳細へ</Button>
      </form>
    </PageShell>
  );
}
