import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type MeetingGuardRow = {
  id: string;
  organization_id: string;
};

type CommentRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  parent_comment_id: string | null;
  block_id: string | null;
  selected_text: string | null;
  body: string;
  mentioned_user_ids: string[] | null;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

type EnrichedComment = CommentRow & {
  author: ProfileRow | null;
  resolver: ProfileRow | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullable(value: unknown) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    supabase,
    user,
  };
}

async function ensureMeetingAccessible({
  supabase,
  meetingId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  meetingId: string;
}) {
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, organization_id")
    .eq("id", meetingId)
    .maybeSingle<MeetingGuardRow>();

  return meeting;
}

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthContext();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const meetingId = normalizeText(new URL(request.url).searchParams.get("meetingId"));
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required." }, { status: 400 });
  }

  const meeting = await ensureMeetingAccessible({ supabase, meetingId });
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const { data: comments, error: commentsError } = await supabase
    .from("comments")
    .select(
      "id, organization_id, meeting_id, parent_comment_id, block_id, selected_text, body, mentioned_user_ids, is_resolved, resolved_at, resolved_by, created_by, created_at, updated_at",
    )
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  const commentRows = (comments ?? []) as CommentRow[];
  const profileIds = Array.from(
    new Set(
      commentRows
        .flatMap((comment) => [comment.created_by, comment.resolved_by])
        .filter((id): id is string => Boolean(id)),
    ),
  );

  let profileMap = new Map<string, ProfileRow>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .in("id", profileIds);

    profileMap = new Map(
      ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
    );
  }

  const enrichedComments: EnrichedComment[] = commentRows.map((comment) => ({
    ...comment,
    author: profileMap.get(comment.created_by) ?? null,
    resolver: comment.resolved_by ? profileMap.get(comment.resolved_by) ?? null : null,
  }));

  return NextResponse.json({ comments: enrichedComments });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthContext();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    meetingId?: string;
    organizationId?: string;
    blockId?: string;
    selectedText?: string;
    body?: string;
    parentCommentId?: string | null;
    mentionedUserIds?: string[];
  } | null;

  const meetingId = normalizeText(body?.meetingId);
  const organizationId = normalizeText(body?.organizationId);
  const blockId = toNullable(body?.blockId);
  const selectedText = toNullable(body?.selectedText);
  const commentBody = normalizeText(body?.body);
  const parentCommentId = toNullable(body?.parentCommentId);
  const mentionedUserIds = Array.isArray(body?.mentionedUserIds)
    ? body?.mentionedUserIds.filter((value) => typeof value === "string")
    : [];

  if (!meetingId || !organizationId || !commentBody) {
    return NextResponse.json(
      { error: "meetingId, organizationId, body are required." },
      { status: 400 },
    );
  }

  const meeting = await ensureMeetingAccessible({ supabase, meetingId });
  if (!meeting || meeting.organization_id !== organizationId) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const { data: comment, error: insertError } = await supabase
    .from("comments")
    .insert({
      meeting_id: meetingId,
      organization_id: organizationId,
      block_id: blockId,
      selected_text: selectedText,
      body: commentBody,
      parent_comment_id: parentCommentId,
      mentioned_user_ids: mentionedUserIds,
      created_by: user.id,
    })
    .select(
      "id, organization_id, meeting_id, parent_comment_id, block_id, selected_text, body, mentioned_user_ids, is_resolved, resolved_at, resolved_by, created_by, created_at, updated_at",
    )
    .single<CommentRow>();

  if (insertError || !comment) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert comment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ comment });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getAuthContext();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    commentId?: string;
    isResolved?: boolean;
  } | null;

  const commentId = normalizeText(body?.commentId);
  const isResolved = Boolean(body?.isResolved);

  if (!commentId) {
    return NextResponse.json({ error: "commentId is required." }, { status: 400 });
  }

  const { data: comment, error: updateError } = await supabase
    .from("comments")
    .update({
      is_resolved: isResolved,
      resolved_at: isResolved ? new Date().toISOString() : null,
      resolved_by: isResolved ? user.id : null,
    })
    .eq("id", commentId)
    .select(
      "id, organization_id, meeting_id, parent_comment_id, block_id, selected_text, body, mentioned_user_ids, is_resolved, resolved_at, resolved_by, created_by, created_at, updated_at",
    )
    .single<CommentRow>();

  if (updateError || !comment) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update comment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ comment });
}
