"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type StartResponse = {
  clientSecret: string;
  meetingId: string;
  realtimeSessionId: string;
  model: string;
};

type LocalCorrectionRule = {
  wrongText: string;
  correctText: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return "リアルタイム文字起こしに失敗しました。";
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiToken(text: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text);
}

function buildSafeCorrectionRegex(wrongText: string) {
  const escaped = escapeRegex(wrongText);

  if (isAsciiToken(wrongText)) {
    return new RegExp(`\\b${escaped}\\b`, "g");
  }

  if (/^[ァ-ヶー]+$/.test(wrongText)) {
    return new RegExp(`(?<![ァ-ヶー])${escaped}(?![ァ-ヶー])`, "g");
  }

  if (/^[ぁ-んー]+$/.test(wrongText)) {
    return new RegExp(`(?<![ぁ-んー])${escaped}(?![ぁ-んー])`, "g");
  }

  if (/^[一-龠々]+$/.test(wrongText)) {
    return new RegExp(`(?<![一-龠々])${escaped}(?![一-龠々])`, "g");
  }

  return new RegExp(escaped, "g");
}

function applySafeReplace(input: string, wrongText: string, correctText: string) {
  if (!input) {
    return input;
  }
  return input.replace(buildSafeCorrectionRegex(wrongText), correctText);
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

function getEventText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const event = value as {
    type?: unknown;
    delta?: unknown;
    transcript?: unknown;
    text?: unknown;
    item?: {
      transcript?: unknown;
      text?: unknown;
    };
    error?: {
      message?: unknown;
    };
  };

  const type = normalizeText(event.type);

  if (
    type === "conversation.item.input_audio_transcription.completed" ||
    type === "response.output_text.done" ||
    type === "response.output_audio_transcript.done" ||
    type === "transcript.text.done"
  ) {
    return (
      normalizeText(event.transcript) ||
      normalizeText(event.text) ||
      normalizeText(event.item?.transcript) ||
      normalizeText(event.item?.text)
    );
  }

  return "";
}

function getEventDelta(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const event = value as {
    type?: unknown;
    delta?: unknown;
  };

  const type = normalizeText(event.type);

  if (
    type === "conversation.item.input_audio_transcription.delta" ||
    type === "response.output_text.delta" ||
    type === "response.output_audio_transcript.delta" ||
    type === "transcript.text.delta"
  ) {
    return normalizeText(event.delta);
  }

  return "";
}

export function LiveTranscriptionPanel({
  orgSlug,
  organizationId,
  defaultLlm,
}: {
  orgSlug: string;
  organizationId: string;
  defaultLlm: "claude-sonnet-4-6" | "gpt-5.4";
}) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [llmUsed, setLlmUsed] = useState<"claude-sonnet-4-6" | "gpt-5.4">(defaultLlm);
  const [isStarting, setIsStarting] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [realtimeSessionId, setRealtimeSessionId] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [partialText, setPartialText] = useState("");
  const [wrongText, setWrongText] = useState("");
  const [correctText, setCorrectText] = useState("");
  const [context, setContext] = useState("");
  const [isPronunciationVariant, setIsPronunciationVariant] = useState(true);
  const [createGlossaryTerm, setCreateGlossaryTerm] = useState(true);
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [correctionSuccess, setCorrectionSuccess] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);
  const meetingIdRef = useRef("");
  const realtimeSessionIdRef = useRef("");
  const transcriptRef = useRef("");
  const partialRef = useRef("");
  const localCorrectionsRef = useRef<LocalCorrectionRule[]>([]);

  function applyLocalCorrections(text: string) {
    let result = text;
    for (const rule of localCorrectionsRef.current) {
      result = applySafeReplace(result, rule.wrongText, rule.correctText);
    }
    return result;
  }

  function cleanupConnection() {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerRef.current?.close();
    peerRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
  }

  function appendCommittedLine(text: string) {
    const normalized = applyLocalCorrections(normalizeText(text));
    if (!normalized) {
      return;
    }

    const nextTranscript = transcriptRef.current
      ? `${transcriptRef.current}\n${normalized}`
      : normalized;
    transcriptRef.current = nextTranscript;
    setTranscriptText(nextTranscript);
  }

  function pullSelectionForCorrection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const anchorNode = selection.anchorNode;
    if (!anchorNode || !transcriptBoxRef.current?.contains(anchorNode)) {
      return;
    }

    const selectedText = normalizeText(selection.toString());
    if (!selectedText) {
      return;
    }

    setWrongText(selectedText);
    const fullLiveTranscript = transcriptRef.current
      ? `${transcriptRef.current}\n${partialRef.current}`
      : partialRef.current;
    setContext(findContextAroundSelection(fullLiveTranscript, selectedText));
  }

  async function handleSaveCorrection() {
    if (isSavingCorrection) {
      return;
    }

    const normalizedWrong = normalizeText(wrongText);
    const normalizedCorrect = normalizeText(correctText);
    const currentMeetingId = normalizeText(meetingIdRef.current || meetingId);

    if (!currentMeetingId) {
      setCorrectionError("先にライブ文字起こしを開始してください。");
      return;
    }
    if (!normalizedWrong || !normalizedCorrect) {
      setCorrectionError("誤認識語と正しい語を入力してください。");
      return;
    }

    setIsSavingCorrection(true);
    setCorrectionError("");
    setCorrectionSuccess("");

    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId: currentMeetingId,
          organizationId,
          wrongText: normalizedWrong,
          correctText: normalizedCorrect,
          context,
          isPronunciationVariant,
          applyGlobally: true,
          createGlossaryTerm,
          termData: {},
        }),
      });

      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "訂正保存に失敗しました。");
      }

      localCorrectionsRef.current = [
        ...localCorrectionsRef.current.filter((rule) => rule.wrongText !== normalizedWrong),
        { wrongText: normalizedWrong, correctText: normalizedCorrect },
      ];

      transcriptRef.current = applySafeReplace(
        transcriptRef.current,
        normalizedWrong,
        normalizedCorrect,
      );
      setTranscriptText(transcriptRef.current);
      setPartialText(applyLocalCorrections(partialRef.current));

      setCorrectionSuccess("保存して学習しました。以降の表示にも即反映します。");
      setWrongText("");
      setContext("");
      setCorrectText(normalizedCorrect);
    } catch (saveError) {
      setCorrectionError(formatErrorMessage(saveError));
    } finally {
      setIsSavingCorrection(false);
    }
  }

  function flushPartial() {
    const pending = normalizeText(partialRef.current);
    if (!pending) {
      return;
    }
    appendCommittedLine(pending);
    partialRef.current = "";
    setPartialText("");
  }

  useEffect(() => {
    return () => {
      cleanupConnection();
    };
  }, []);

  async function handleStart() {
    if (isStarting || isLive) {
      return;
    }

    setError("");
    setInfo("");
    setIsStarting(true);
    transcriptRef.current = "";
    partialRef.current = "";
    setTranscriptText("");
    setPartialText("");
    setWrongText("");
    setContext("");
    setCorrectionError("");
    setCorrectionSuccess("");
    meetingIdRef.current = "";
    realtimeSessionIdRef.current = "";
    setMeetingId("");
    setRealtimeSessionId("");
    localCorrectionsRef.current = [];

    try {
      const tokenResponse = await fetch("/api/realtime/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
          title,
          llmUsed,
        }),
      });

      const tokenJson = (await tokenResponse.json().catch(() => null)) as
        | ({ error?: string } & Partial<StartResponse>)
        | null;

      if (!tokenResponse.ok || !tokenJson?.clientSecret || !tokenJson.meetingId || !tokenJson.realtimeSessionId) {
        throw new Error(tokenJson?.error || "Realtimeトークンの取得に失敗しました。");
      }

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = localStream;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      localStream.getTracks().forEach((track) => {
        peer.addTrack(track, localStream);
      });

      const dataChannel = peer.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;

      dataChannel.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as unknown;
          if (
            payload &&
            typeof payload === "object" &&
            "type" in payload &&
            normalizeText((payload as { type?: unknown }).type) === "error"
          ) {
            const errorMessage = normalizeText(
              (payload as { error?: { message?: unknown } }).error?.message,
            );
            if (errorMessage) {
              setError(`Realtimeエラー: ${errorMessage}`);
            }
          }

          const delta = getEventDelta(payload);
          if (delta) {
            partialRef.current += delta;
            setPartialText(applyLocalCorrections(partialRef.current));
          }

          const text = getEventText(payload);
          if (text) {
            appendCommittedLine(text);
            partialRef.current = "";
            setPartialText("");
          }
        } catch {
          // Ignore non-JSON events.
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(tokenJson.model || "gpt-4o-realtime-preview-2024-12-17")}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenJson.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );

      if (!sdpResponse.ok) {
        const reason = await sdpResponse.text();
        throw new Error(`WebRTC接続に失敗しました: ${reason || sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await peer.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      meetingIdRef.current = tokenJson.meetingId;
      realtimeSessionIdRef.current = tokenJson.realtimeSessionId;
      setMeetingId(tokenJson.meetingId);
      setRealtimeSessionId(tokenJson.realtimeSessionId);
      setInfo("ライブ文字起こしを開始しました。");
      setIsLive(true);
    } catch (startError) {
      cleanupConnection();
      setError(formatErrorMessage(startError));
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStop() {
    if (!isLive || isEnding) {
      return;
    }

    setError("");
    setInfo("");
    setIsEnding(true);

    try {
      flushPartial();
      cleanupConnection();
      setIsLive(false);

      const currentMeetingId = normalizeText(meetingIdRef.current || meetingId);
      const currentRealtimeSessionId = normalizeText(
        realtimeSessionIdRef.current || realtimeSessionId,
      );
      const finalTranscript = normalizeText(transcriptRef.current || partialRef.current);

      if (!currentMeetingId || !currentRealtimeSessionId) {
        throw new Error(
          "セッションIDの取得に失敗しました。ページを再読み込みしてライブ文字起こしを再開始してください。",
        );
      }

      if (!finalTranscript) {
        throw new Error(
          "まだ文字起こし結果がありません。数秒発話してから停止するか、再度開始してください。",
        );
      }

      const completeResponse = await fetch("/api/realtime/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId: currentMeetingId,
          organizationId,
          realtimeSessionId: currentRealtimeSessionId,
          transcript: finalTranscript,
        }),
      });

      const completeJson = (await completeResponse.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!completeResponse.ok || !completeJson?.success) {
        throw new Error(completeJson?.error || "議事録生成に失敗しました。");
      }

      router.push(
        `/orgs/${orgSlug}/meetings/${currentMeetingId}?success=${encodeURIComponent(
          "ライブ文字起こしを終了し、議事録を生成しました。",
        )}`,
      );
    } catch (stopError) {
      setError(formatErrorMessage(stopError));
      setInfo("ライブセッションは停止しました。議事録生成は再実行してください。");
    } finally {
      setIsEnding(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {info ? (
        <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="liveTitle" className="text-sm font-medium">
          会議タイトル（任意）
        </label>
        <input
          id="liveTitle"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="ライブ会議 2026/04/09"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          disabled={isLive || isStarting || isEnding}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="liveLlm" className="text-sm font-medium">
          議事録生成LLM
        </label>
        <select
          id="liveLlm"
          value={llmUsed}
          onChange={(event) =>
            setLlmUsed(event.target.value === "gpt-5.4" ? "gpt-5.4" : "claude-sonnet-4-6")
          }
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          disabled={isLive || isStarting || isEnding}
        >
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="gpt-5.4">gpt-5.4</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleStart} disabled={isStarting || isLive || isEnding}>
          {isStarting ? "接続中..." : "ライブ文字起こしを開始"}
        </Button>
        <Button type="button" variant="outline" onClick={handleStop} disabled={!isLive || isEnding}>
          {isEnding ? "終了処理中..." : "停止して議事録生成"}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          状態: {isLive ? "録音中" : "停止中"}
          {meetingId ? ` / meeting_id: ${meetingId}` : ""}
        </p>
        <div className="min-h-48 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">
          <div
            ref={transcriptBoxRef}
            onMouseUp={pullSelectionForCorrection}
            className="min-h-40 whitespace-pre-wrap"
          >
            {transcriptText ? transcriptText : "ここにリアルタイム文字起こしが表示されます。"}
            {partialText ? <span className="opacity-70">{transcriptText ? `\n${partialText}` : partialText}</span> : null}
          </div>
        </div>
      </div>

      <section className="space-y-3 rounded-md border bg-muted/10 p-3">
        <div>
          <p className="text-sm font-medium">ライブ中にその場で訂正</p>
          <p className="text-xs text-muted-foreground">
            文字起こし本文を選択して「選択を取り込む」を押すと、後からではなく今すぐ学習できます。
          </p>
        </div>

        {correctionError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {correctionError}
          </p>
        ) : null}
        {correctionSuccess ? (
          <p className="rounded-md border border-emerald-300/50 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
            {correctionSuccess}
          </p>
        ) : null}

        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
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
          <Button type="button" variant="outline" onClick={pullSelectionForCorrection}>
            選択を取り込む
          </Button>
        </div>

        <textarea
          value={context}
          onChange={(event) => setContext(event.target.value)}
          rows={2}
          placeholder="文脈"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />

        <div className="space-y-1 text-xs">
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
              checked={createGlossaryTerm}
              onChange={(event) => setCreateGlossaryTerm(event.target.checked)}
            />
            用語辞書にも反映する
          </label>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={isSavingCorrection}
          onClick={handleSaveCorrection}
        >
          {isSavingCorrection ? "保存中..." : "この訂正を保存"}
        </Button>
      </section>
    </div>
  );
}
