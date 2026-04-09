"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type UncertainCandidate = {
  term: string;
  guess_full_form: string | null;
  guess_definition: string | null;
  guess_category: string | null;
  review_needed: boolean;
  heard_text: string | null;
  context_excerpt: string | null;
  question: string | null;
};

function normalizeText(value: string) {
  return value.trim();
}

function toUserError(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "用語確認の保存に失敗しました。";
}

export function UncertainTermReviewCard({
  organizationId,
  meetingId,
  candidate,
}: {
  organizationId: string;
  meetingId: string;
  candidate: UncertainCandidate;
}) {
  const router = useRouter();
  const wrongText = candidate.heard_text ?? candidate.term;

  const [correctText, setCorrectText] = useState(candidate.term ?? "");
  const [isPronunciationVariant, setIsPronunciationVariant] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const normalizedCorrect = normalizeText(correctText);
    if (!normalizedCorrect) {
      setError("正しい用語を入力してください。");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId,
          organizationId,
          wrongText,
          correctText: normalizedCorrect,
          context: candidate.context_excerpt ?? "",
          isPronunciationVariant,
          applyGlobally: true,
          createGlossaryTerm: true,
          termData: {
            definition: candidate.guess_definition ?? "",
            full_form: candidate.guess_full_form ?? "",
            category: candidate.guess_category ?? "略語",
          },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        updatedMeetings?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "用語確認の保存に失敗しました。");
      }

      setSuccess(
        `保存しました。${typeof data.updatedMeetings === "number" ? `${data.updatedMeetings}件の議事録を更新` : ""}`,
      );
      router.refresh();
    } catch (submitError) {
      setError(toUserError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 text-sm">
      <p className="font-medium">確認が必要な用語</p>
      <p className="text-sm">
        {candidate.question ?? "この部分なんて言ってますか？ 正しい用語を入力してください。"}
      </p>
      <p className="text-xs text-muted-foreground">認識: {wrongText}</p>
      {candidate.context_excerpt ? (
        <p className="rounded-md border bg-background px-2 py-1 text-xs">{candidate.context_excerpt}</p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          {success}
        </p>
      ) : null}

      <input
        value={correctText}
        onChange={(event) => setCorrectText(event.target.value)}
        placeholder="正しい用語"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={isPronunciationVariant}
          onChange={(event) => setIsPronunciationVariant(event.target.checked)}
        />
        これは発音違いです（今後の認識学習に使う）
      </label>

      <Button type="submit" variant="outline" disabled={submitting || !normalizeText(correctText)}>
        {submitting ? "保存中..." : "正しい用語を保存して学習"}
      </Button>
    </form>
  );
}
