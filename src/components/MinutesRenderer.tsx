"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

import { GlossaryTerm } from "@/components/GlossaryTerm";
import { Button } from "@/components/ui/button";

type GlossaryTermLookupRow = {
  id: string;
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  pronunciation_variants: string[] | null;
};

function escapeAttributeValue(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceGlossarySyntax(markdown: string) {
  return markdown.replace(/\{\{term:([^}]+)\}\}/g, (_, rawTerm) => {
    const term = String(rawTerm).trim();
    return `<glossary-term data-term="${escapeAttributeValue(term)}"></glossary-term>`;
  });
}

function normalizeText(value: string) {
  return value.trim();
}

function findContextAroundSelection(content: string, selectedText: string) {
  const index = content.indexOf(selectedText);
  if (index === -1) {
    return "";
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(content.length, index + selectedText.length + 50);
  return content.slice(start, end);
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

export function MinutesRenderer({
  markdown,
  glossaryTerms,
  orgSlug,
  meetingId,
  organizationId,
}: {
  markdown: string;
  glossaryTerms: GlossaryTermLookupRow[];
  orgSlug: string;
  meetingId?: string;
  organizationId?: string;
}) {
  const router = useRouter();
  const termMap = useMemo(
    () => new Map(glossaryTerms.map((term) => [term.term, term])),
    [glossaryTerms],
  );
  const processedMarkdown = useMemo(() => replaceGlossarySyntax(markdown), [markdown]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const correctionEnabled = Boolean(meetingId && organizationId);

  const [wrongText, setWrongText] = useState("");
  const [correctText, setCorrectText] = useState("");
  const [context, setContext] = useState("");
  const [isPronunciationVariant, setIsPronunciationVariant] = useState(false);
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
    const plainText = contentRef.current?.innerText ?? markdown;
    setContext(findContextAroundSelection(plainText, selectedText));
  }

  async function submitCorrection() {
    if (submitting || !meetingId || !organizationId) {
      return;
    }

    const normalizedWrong = normalizeText(wrongText);
    const normalizedCorrect = normalizeText(correctText);

    if (!normalizedWrong || !normalizedCorrect) {
      setError("誤認識語と正しい語を入力してください。");
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
          termData: {},
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
      setSuccess(`本文の訂正を反映しました。${keywordMessage}`);
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

  const markdownComponents = {
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className="mt-6 text-xl font-semibold">{children}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className="mt-4 text-lg font-semibold">{children}</h3>
    ),
    p: ({ children }: { children?: ReactNode }) => <p className="leading-7">{children}</p>,
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className="list-disc space-y-1 pl-6">{children}</ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className="list-decimal space-y-1 pl-6">{children}</ol>
    ),
    li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
    strong: ({ children }: { children?: ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    "glossary-term": (props: Record<string, unknown>) => {
      const termValue = props["data-term"];
      const term = typeof termValue === "string" ? termValue : "";
      const termData = termMap.get(term);
      return <GlossaryTerm term={term} data={termData} orgSlug={orgSlug} />;
    },
  };

  return (
    <div className="space-y-4 rounded-lg border bg-background p-4">
      <div ref={contentRef} onMouseUp={fillFromSelection}>
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={markdownComponents as never}
        >
          {processedMarkdown}
        </ReactMarkdown>
      </div>

      {correctionEnabled ? (
        <section className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div>
            <h3 className="text-sm font-semibold">本文の誤認識をその場で訂正</h3>
            <p className="text-xs text-muted-foreground">
              議事録本文で語句を選択して「選択を取り込む」を押し、正しい語に直せます。
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

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={wrongText}
              onChange={(event) => setWrongText(event.target.value)}
              placeholder="誤認識語"
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <input
              value={correctText}
              onChange={(event) => setCorrectText(event.target.value)}
              placeholder="正しい語"
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <Button type="button" variant="outline" onClick={fillFromSelection}>
              選択を取り込む
            </Button>
          </div>

          <textarea
            value={context}
            onChange={(event) => setContext(event.target.value)}
            rows={2}
            placeholder="文脈（自動入力）"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />

          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isPronunciationVariant}
                onChange={(event) => setIsPronunciationVariant(event.target.checked)}
              />
              これは発音違いです
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

          <Button
            type="button"
            onClick={submitCorrection}
            disabled={submitting || !normalizeText(wrongText) || !normalizeText(correctText)}
          >
            {submitting ? "登録中..." : "この訂正を保存"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
