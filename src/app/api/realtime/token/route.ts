import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type RequestBody = {
  organizationId?: string;
  title?: string;
  llmUsed?: string;
};

type MembershipRow = {
  role: "owner" | "admin" | "member";
};

type MeetingInsertRow = {
  id: string;
};

type RealtimeSessionInsertRow = {
  id: string;
};

type GlossaryTermRow = {
  term: string;
  reading: string | null;
  pronunciation_variants: string[] | null;
};

const DEFAULT_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-4o-realtime-preview-2024-12-17";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLlm(value: string) {
  return value === "gpt-4o" ? "gpt-4o" : "claude-sonnet-4-6";
}

function toDefaultMeetingTitle() {
  return `ライブ会議 ${new Date().toLocaleString("ja-JP")}`;
}

function buildGlossaryHint(terms: GlossaryTermRow[]) {
  const rawHint = terms
    .map((term) => {
      const readings = [term.reading, ...(term.pronunciation_variants ?? []).slice(0, 2)].filter(
        Boolean,
      ) as string[];

      if (readings.length === 0) {
        return term.term;
      }

      return `${term.term}(${readings.join("・")})`;
    })
    .join("、");

  return rawHint.length > 1000 ? rawHint.slice(0, 1000) : rawHint;
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set." }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const organizationId = normalizeText(body?.organizationId);
  const title = normalizeText(body?.title) || toDefaultMeetingTitle();
  const llmUsed = normalizeLlm(normalizeText(body?.llmUsed));

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle<MembershipRow>();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .insert({
      organization_id: organizationId,
      title,
      meeting_date: new Date().toISOString(),
      llm_used: llmUsed,
      status: "transcribing",
      created_by: user.id,
    })
    .select("id")
    .single<MeetingInsertRow>();

  if (meetingError || !meeting) {
    return NextResponse.json(
      { error: `Failed to create meeting: ${meetingError?.message}` },
      { status: 500 },
    );
  }

  const { data: realtimeSession, error: realtimeSessionError } = await supabase
    .from("realtime_sessions")
    .insert({
      meeting_id: meeting.id,
      organization_id: organizationId,
      status: "active",
    })
    .select("id")
    .single<RealtimeSessionInsertRow>();

  if (realtimeSessionError || !realtimeSession) {
    await supabase.from("meetings").delete().eq("id", meeting.id);
    return NextResponse.json(
      { error: `Failed to create realtime session: ${realtimeSessionError?.message}` },
      { status: 500 },
    );
  }

  const { data: terms } = await supabase
    .from("glossary_terms")
    .select("term, reading, pronunciation_variants")
    .eq("organization_id", organizationId)
    .order("occurrence_count", { ascending: false })
    .limit(50);

  const glossaryHint = buildGlossaryHint((terms ?? []) as GlossaryTermRow[]);
  const instructions = `日本語の医療・研究会議の音声を高精度で文字起こししてください。補足説明は不要で、文字起こし本文のみを出力してください。
${glossaryHint ? `専門用語ヒント: ${glossaryHint}` : ""}`;

  const realtimeResponse = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_REALTIME_MODEL,
      modalities: ["text"],
      instructions,
    }),
  });

  const realtimeJson = (await realtimeResponse.json().catch(() => null)) as
    | {
        client_secret?: { value?: string; expires_at?: number };
        error?: { message?: string };
      }
    | null;

  const clientSecret = realtimeJson?.client_secret?.value;

  if (!realtimeResponse.ok || !clientSecret) {
    await supabase
      .from("realtime_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", realtimeSession.id);
    await supabase.from("meetings").update({ status: "failed" }).eq("id", meeting.id);

    const reason =
      realtimeJson?.error?.message ||
      `OpenAI realtime session request failed with status ${realtimeResponse.status}`;

    return NextResponse.json({ error: reason }, { status: 500 });
  }

  return NextResponse.json({
    clientSecret,
    expiresAt: realtimeJson?.client_secret?.expires_at ?? null,
    meetingId: meeting.id,
    realtimeSessionId: realtimeSession.id,
    model: DEFAULT_REALTIME_MODEL,
  });
}
