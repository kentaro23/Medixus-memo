import { NextRequest, NextResponse } from "next/server";

import { generateMinutesForMeeting } from "@/lib/meeting-pipeline";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MeetingAuthRow = {
  id: string;
  organization_id: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { meetingId?: string } | null;
  const meetingId = body?.meetingId?.trim();

  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required." }, { status: 400 });
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, organization_id")
    .eq("id", meetingId)
    .maybeSingle<MeetingAuthRow>();

  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  try {
    const minutes = await generateMinutesForMeeting(meetingId);
    return NextResponse.json({ success: true, minutes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
