import { NextRequest, NextResponse } from "next/server";

import { generateMinutesForMeeting } from "@/lib/meeting-pipeline";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  meetingId?: string;
  organizationId?: string;
  realtimeSessionId?: string;
  transcript?: string;
};

type MeetingRow = {
  id: string;
  organization_id: string;
};

type RealtimeSessionRow = {
  id: string;
  started_at: string;
};

type CorrectionRow = {
  wrong_text: string;
  correct_text: string;
  context_keywords: string[] | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCorrections(transcript: string, corrections: CorrectionRow[]) {
  let result = transcript;

  for (const correction of corrections) {
    if (!correction.wrong_text || !correction.correct_text) {
      continue;
    }

    const escaped = escapeRegex(correction.wrong_text);

    if (correction.context_keywords && correction.context_keywords.length > 0) {
      const regex = new RegExp(`(.{0,80})${escaped}(.{0,80})`, "g");

      result = result.replace(regex, (match, before: string, after: string) => {
        const surrounding = `${before}${after}`;
        const hasContext = correction.context_keywords?.some((keyword) =>
          surrounding.includes(keyword),
        );
        return hasContext ? `${before}${correction.correct_text}${after}` : match;
      });
      continue;
    }

    result = result.replace(new RegExp(escaped, "g"), correction.correct_text);
  }

  return result;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const meetingId = normalizeText(body?.meetingId);
  const organizationId = normalizeText(body?.organizationId);
  const realtimeSessionId = normalizeText(body?.realtimeSessionId);
  const transcript = normalizeText(body?.transcript);

  if (!meetingId || !organizationId || !realtimeSessionId || !transcript) {
    return NextResponse.json(
      { error: "meetingId, organizationId, realtimeSessionId, transcript are required." },
      { status: 400 },
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, organization_id")
    .eq("id", meetingId)
    .maybeSingle<MeetingRow>();

  if (!meeting || meeting.organization_id !== organizationId) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const endedAt = new Date();
  const endedAtIso = endedAt.toISOString();

  const { data: realtimeSession, error: realtimeSessionError } = await supabase
    .from("realtime_sessions")
    .update({
      status: "ended",
      ended_at: endedAtIso,
    })
    .eq("id", realtimeSessionId)
    .eq("meeting_id", meetingId)
    .eq("organization_id", organizationId)
    .select("id, started_at")
    .single<RealtimeSessionRow>();

  if (realtimeSessionError || !realtimeSession) {
    return NextResponse.json(
      { error: `Realtime session not found: ${realtimeSessionError?.message}` },
      { status: 404 },
    );
  }

  const { data: correctionRows } = await supabase
    .from("transcription_corrections")
    .select("wrong_text, correct_text, context_keywords")
    .eq("organization_id", organizationId)
    .eq("apply_globally", true);

  const correctedTranscript = applyCorrections(
    transcript,
    (correctionRows ?? []) as CorrectionRow[],
  );

  const startedAt = new Date(realtimeSession.started_at);
  const durationSeconds = Math.max(
    0,
    Number.isNaN(startedAt.getTime())
      ? 0
      : Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  );

  await supabase
    .from("meetings")
    .update({
      raw_transcript: transcript,
      corrected_transcript: correctedTranscript,
      duration_seconds: durationSeconds,
      status: "generating",
    })
    .eq("id", meetingId);

  try {
    const minutes = await generateMinutesForMeeting(meetingId);
    return NextResponse.json({
      success: true,
      meetingId,
      minutes,
    });
  } catch (error) {
    await supabase.from("meetings").update({ status: "failed" }).eq("id", meetingId);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate minutes: ${message}` },
      { status: 500 },
    );
  }
}
