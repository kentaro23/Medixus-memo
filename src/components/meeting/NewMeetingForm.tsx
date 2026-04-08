"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type ErrorWithMessage = {
  message: string;
};

type MeetingInsertResult = {
  id: string;
} | null;

function normalizeText(value: string) {
  return value.trim();
}

function sanitizeFilename(filename: string) {
  const normalized = filename.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return normalized.length > 0 ? normalized : "audio.wav";
}

function toIsoDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function toUserMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const err = error as ErrorWithMessage;
    if (typeof err.message === "string" && err.message.length > 0) {
      return err.message;
    }
  }
  return "処理に失敗しました。時間をおいて再度お試しください。";
}

export function NewMeetingForm({
  orgSlug,
  organizationId,
  defaultLlm,
}: {
  orgSlug: string;
  organizationId: string;
  defaultLlm: "claude-sonnet-4-6" | "gpt-4o";
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [llmUsed, setLlmUsed] = useState<"claude-sonnet-4-6" | "gpt-4o">(defaultLlm);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      setError("会議タイトルは必須です。");
      return;
    }

    if (!audioFile) {
      setError("音声ファイルを選択してください。");
      return;
    }

    setIsSubmitting(true);
    setError("");

    let meetingId = "";
    let storagePath = "";

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("ログインセッションが確認できません。再ログインしてください。");
      }

      const { data: meeting, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          organization_id: organizationId,
          title: normalizedTitle,
          meeting_date: toIsoDate(meetingDate),
          llm_used: llmUsed,
          status: "pending",
          created_by: user.id,
        })
        .select("id")
        .single();

      const typedMeeting = meeting as MeetingInsertResult;

      if (meetingError || !typedMeeting) {
        throw new Error(`会議作成に失敗しました: ${meetingError?.message ?? "unknown error"}`);
      }

      meetingId = typedMeeting.id;
      const safeFilename = sanitizeFilename(audioFile.name || "audio.wav");
      storagePath = `${organizationId}/${typedMeeting.id}/${Date.now()}-${safeFilename}`;

      const { error: uploadError } = await supabase.storage
        .from("audio")
        .upload(storagePath, audioFile, {
          contentType: audioFile.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`音声アップロードに失敗しました: ${uploadError.message}`);
      }

      const { error: updateError } = await supabase
        .from("meetings")
        .update({
          audio_url: storagePath,
        })
        .eq("id", typedMeeting.id);

      if (updateError) {
        throw new Error(`会議更新に失敗しました: ${updateError.message}`);
      }

      router.push(
        `/orgs/${orgSlug}/meetings/${typedMeeting.id}?message=${encodeURIComponent(
          "音声アップロードが完了しました。文字起こしを開始してください。",
        )}`,
      );
    } catch (submitError) {
      if (storagePath) {
        await supabase.storage.from("audio").remove([storagePath]);
      }
      if (meetingId) {
        await supabase.from("meetings").delete().eq("id", meetingId);
      }
      setError(toUserMessage(submitError));
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="title" className="text-sm font-medium">
          会議タイトル *
        </label>
        <input
          id="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
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
            type="datetime-local"
            value={meetingDate}
            onChange={(event) => setMeetingDate(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="llmUsed" className="text-sm font-medium">
            議事録生成LLM
          </label>
          <select
            id="llmUsed"
            value={llmUsed}
            onChange={(event) =>
              setLlmUsed(event.target.value === "gpt-4o" ? "gpt-4o" : "claude-sonnet-4-6")
            }
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
          type="file"
          accept="audio/*"
          required
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setAudioFile(selected);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Supabase Storageへ直接アップロードします。大きいファイルでも処理しやすくなります。
        </p>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "アップロード中..." : "保存して詳細へ"}
      </Button>
    </form>
  );
}
