"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

function normalizeText(value: string) {
  return value.trim();
}

function findContextAroundSelection(transcript: string, selectedText: string) {
  const index = transcript.indexOf(selectedText);
  if (index === -1) {
    return "";
  }
  const start = Math.max(0, index - 50);
  const end = Math.min(transcript.length, index + selectedText.length + 50);
  return transcript.slice(start, end);
}

function toUserError(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "訂正登録に失敗しました。";
}

export function TranscriptCorrectionPanel({
  organizationId,
  meetingId,
  correctedTranscript,
}: {
  organizationId: string;
  meetingId: string;
  correctedTranscript: string;
}) {
  const router = useRouter();
  const transcriptText = useMemo(() => correctedTranscript || "", [correctedTranscript]);

  const [wrongText, setWrongText] = useState("");
  const [correctText, setCorrectText] = useState("");
  const [context, setContext] = useState("");
  const [reading, setReading] = useState("");
  const [fullForm, setFullForm] = useState("");
  const [definition, setDefinition] = useState("");
  const [detailedExplanation, setDetailedExplanation] = useState("");
  const [category, setCategory] = useState("略語");
  const [isPronunciationVariant, setIsPronunciationVariant] = useState(true);
  const [applyGlobally, setApplyGlobally] = useState(true);
  const [createGlossaryTerm, setCreateGlossaryTerm] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function fillFromSelection() {
    const selection = window.getSelection();
    const selectedText = normalizeText(selection?.toString() ?? "");
    if (!selectedText) {
      return;
    }
    setWrongText(selectedText);
    setContext(findContextAroundSelection(transcriptText, selectedText));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const normalizedWrong = normalizeText(wrongText);
    const normalizedCorrect = normalizeText(correctText);

    if (!normalizedWrong || !normalizedCorrect) {
      setError("誤変換と正しい表記を入力してください。");
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
          wrongText: normalizedWrong,
          correctText: normalizedCorrect,
          context,
          isPronunciationVariant,
          applyGlobally,
          createGlossaryTerm,
          termData: {
            reading,
            full_form: fullForm,
            definition,
            detailed_explanation: detailedExplanation,
            category,
          },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        contextKeywords?: string[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? "訂正登録に失敗しました。");
      }

      const keywordMessage =
        data.contextKeywords && data.contextKeywords.length > 0
          ? `（文脈キーワード: ${data.contextKeywords.join(" / ")}）`
          : "";

      setSuccess(`訂正を登録しました。${keywordMessage}`);
      setWrongText("");
      setCorrectText("");
      setContext("");
      router.refresh();
    } catch (submitError) {
      setError(toUserError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">文字起こし訂正（自己学習）</h2>
        <p className="text-xs text-muted-foreground">
          テキストを選択して「選択を取り込む」を押すと、誤変換をすばやく登録できます。
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      <div
        className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap"
        onMouseUp={fillFromSelection}
      >
        {transcriptText || "訂正対象の文字起こしがありません。"}
      </div>

      <Button type="button" variant="outline" onClick={fillFromSelection}>
        選択を取り込む
      </Button>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="wrongText" className="text-sm font-medium">
              誤変換 *
            </label>
            <input
              id="wrongText"
              value={wrongText}
              onChange={(event) => setWrongText(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="correctText" className="text-sm font-medium">
              正しい表記 *
            </label>
            <input
              id="correctText"
              value={correctText}
              onChange={(event) => setCorrectText(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="context" className="text-sm font-medium">
              文脈（自動抽出可）
            </label>
            <textarea
              id="context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reading" className="text-sm font-medium">
              読み
            </label>
            <input
              id="reading"
              value={reading}
              onChange={(event) => setReading(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="fullForm" className="text-sm font-medium">
              正式名称
            </label>
            <input
              id="fullForm"
              value={fullForm}
              onChange={(event) => setFullForm(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="definition" className="text-sm font-medium">
              定義
            </label>
            <textarea
              id="definition"
              value={definition}
              onChange={(event) => setDefinition(event.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="detailedExplanation" className="text-sm font-medium">
              詳細解説
            </label>
            <textarea
              id="detailedExplanation"
              value={detailedExplanation}
              onChange={(event) => setDetailedExplanation(event.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="category" className="text-sm font-medium">
              カテゴリ
            </label>
            <select
              id="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="略語">略語</option>
              <option value="遺伝子">遺伝子</option>
              <option value="疾患名">疾患名</option>
              <option value="薬剤">薬剤</option>
              <option value="手技">手技</option>
              <option value="その他">その他</option>
            </select>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPronunciationVariant}
              onChange={(event) => setIsPronunciationVariant(event.target.checked)}
            />
            これは発音違いです（wrongTextを発音バリエーションに追加）
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={applyGlobally}
              onChange={(event) => setApplyGlobally(event.target.checked)}
            />
            今後の議事録にも自動適用する
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={createGlossaryTerm}
              onChange={(event) => setCreateGlossaryTerm(event.target.checked)}
            />
            用語辞書にも反映する
          </label>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "登録中..." : "訂正を登録"}
        </Button>
      </form>
    </section>
  );
}
