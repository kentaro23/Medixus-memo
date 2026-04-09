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
  };

  const type = normalizeText(event.type);

  if (
    type === "conversation.item.input_audio_transcription.completed" ||
    type === "response.output_text.done"
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
    type === "response.output_text.delta"
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
  defaultLlm: "claude-sonnet-4-6" | "gpt-4o";
}) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [llmUsed, setLlmUsed] = useState<"claude-sonnet-4-6" | "gpt-4o">(defaultLlm);
  const [isStarting, setIsStarting] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [realtimeSessionId, setRealtimeSessionId] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [partialText, setPartialText] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const transcriptRef = useRef("");
  const partialRef = useRef("");

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
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    const nextTranscript = transcriptRef.current
      ? `${transcriptRef.current}\n${normalized}`
      : normalized;
    transcriptRef.current = nextTranscript;
    setTranscriptText(nextTranscript);
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
          const delta = getEventDelta(payload);
          if (delta) {
            partialRef.current += delta;
            setPartialText(partialRef.current);
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

      dataChannel.onopen = () => {
        dataChannel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["text"],
              instructions:
                "入力された音声を日本語で文字起こししてください。回答は文字起こし本文のみで返してください。",
            },
          }),
        );
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

      const finalTranscript = normalizeText(transcriptRef.current);
      if (!meetingId || !realtimeSessionId || !finalTranscript) {
        throw new Error("終了処理に必要なデータが不足しています。");
      }

      const completeResponse = await fetch("/api/realtime/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId,
          organizationId,
          realtimeSessionId,
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
        `/orgs/${orgSlug}/meetings/${meetingId}?success=${encodeURIComponent(
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
            setLlmUsed(event.target.value === "gpt-4o" ? "gpt-4o" : "claude-sonnet-4-6")
          }
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          disabled={isLive || isStarting || isEnding}
        >
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="gpt-4o">gpt-4o</option>
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
          {transcriptText ? transcriptText : "ここにリアルタイム文字起こしが表示されます。"}
          {partialText ? <span className="opacity-70">{transcriptText ? `\n${partialText}` : partialText}</span> : null}
        </div>
      </div>
    </div>
  );
}
