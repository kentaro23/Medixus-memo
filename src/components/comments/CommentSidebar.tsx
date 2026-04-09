"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

type MemberOption = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
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
  author: Profile | null;
  resolver: Profile | null;
};

function toUserName(profile: Profile | null) {
  if (!profile) {
    return "不明ユーザー";
  }
  return profile.full_name || profile.email;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP");
}

function toErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "コメント処理に失敗しました。";
}

function extractMentionedUserIds({
  body,
  selectedIds,
  members,
}: {
  body: string;
  selectedIds: string[];
  members: MemberOption[];
}) {
  const result = new Set(selectedIds);
  const normalizedBody = body.toLowerCase();

  for (const member of members) {
    const emailHit = normalizedBody.includes(`@${member.email.toLowerCase()}`);
    const name = member.full_name?.trim();
    const nameHit = name ? normalizedBody.includes(`@${name.toLowerCase()}`) : false;
    if (emailHit || nameHit) {
      result.add(member.id);
    }
  }

  return Array.from(result);
}

function mentionLabel(member: MemberOption) {
  return member.full_name || member.email;
}

export function CommentSidebar({
  organizationId,
  meetingId,
  blockIds,
}: {
  organizationId: string;
  meetingId: string;
  blockIds: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState(blockIds[0] ?? "general");
  const [selectedText, setSelectedText] = useState("");
  const [newCommentBody, setNewCommentBody] = useState("");
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const availableBlocks = useMemo(() => {
    const withGeneral = ["general", ...blockIds];
    return Array.from(new Set(withGeneral));
  }, [blockIds]);

  const fetchComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/comments?meetingId=${encodeURIComponent(meetingId)}`);
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        comments?: CommentRow[];
      };
      if (!response.ok) {
        throw new Error(data.error ?? "コメント取得に失敗しました。");
      }
      setComments(data.comments ?? []);
      setError("");
    } catch (fetchError) {
      setError(toErrorMessage(fetchError));
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void fetchComments();

    const channel = supabase
      .channel(`comments:${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `meeting_id=eq.${meetingId}`,
        },
        () => {
          void fetchComments();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchComments, meetingId, supabase]);

  useEffect(() => {
    let active = true;

    async function fetchMembers() {
      try {
        const response = await fetch(
          `/api/organizations/${encodeURIComponent(organizationId)}/members`,
        );
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          members?: MemberOption[];
        };

        if (!response.ok) {
          throw new Error(data.error ?? "メンバー取得に失敗しました。");
        }

        if (!active) {
          return;
        }

        setMembers(data.members ?? []);
      } catch (memberError) {
        if (!active) {
          return;
        }
        setError(toErrorMessage(memberError));
      }
    }

    void fetchMembers();

    return () => {
      active = false;
    };
  }, [organizationId]);

  async function createComment({
    body,
    parentCommentId,
    blockId,
    selectedTextValue,
    mentionIds,
  }: {
    body: string;
    parentCommentId?: string | null;
    blockId?: string | null;
    selectedTextValue?: string;
    mentionIds?: string[];
  }) {
    const normalizedBody = body.trim();
    if (!normalizedBody) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const extractedMentionedUserIds = extractMentionedUserIds({
        body: normalizedBody,
        selectedIds: mentionIds ?? mentionUserIds,
        members,
      });

      const response = await fetch("/api/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId,
          organizationId,
          blockId: blockId ?? selectedBlockId,
          selectedText: selectedTextValue ?? selectedText,
          body: normalizedBody,
          parentCommentId: parentCommentId ?? null,
          mentionedUserIds: extractedMentionedUserIds,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "コメント作成に失敗しました。");
      }

      if (!parentCommentId) {
        setNewCommentBody("");
        setSelectedText("");
        setMentionUserIds([]);
      } else {
        setReplyBodies((prev) => ({
          ...prev,
          [parentCommentId]: "",
        }));
      }

      await fetchComments();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleResolved(commentId: string, isResolved: boolean) {
    try {
      const response = await fetch("/api/comments", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commentId,
          isResolved,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "コメント更新に失敗しました。");
      }

      await fetchComments();
    } catch (toggleError) {
      setError(toErrorMessage(toggleError));
    }
  }

  const groupedByBlock = useMemo(() => {
    const groups = new Map<string, CommentRow[]>();
    for (const blockId of availableBlocks) {
      groups.set(blockId, []);
    }
    for (const comment of comments) {
      const key = comment.block_id || "general";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(comment);
    }
    return groups;
  }, [availableBlocks, comments]);

  return (
    <aside className="space-y-4 rounded-lg border bg-background p-4">
      <div>
        <h2 className="text-sm font-semibold">コメント</h2>
        <p className="text-xs text-muted-foreground">
          ブロック単位でコメントし、返信や解決済み管理ができます。
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="space-y-2 rounded-md border p-3">
        <label htmlFor="blockId" className="text-xs font-medium">
          ブロック
        </label>
        <select
          id="blockId"
          value={selectedBlockId}
          onChange={(event) => setSelectedBlockId(event.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        >
          {availableBlocks.map((blockId) => (
            <option key={blockId} value={blockId}>
              {blockId}
            </option>
          ))}
        </select>

        <label htmlFor="selectedText" className="text-xs font-medium">
          選択テキスト（任意）
        </label>
        <textarea
          id="selectedText"
          value={selectedText}
          onChange={(event) => setSelectedText(event.target.value)}
          rows={2}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          placeholder="引用したい本文を貼り付け"
        />

        <label htmlFor="commentBody" className="text-xs font-medium">
          コメント *
        </label>
        <textarea
          id="commentBody"
          value={newCommentBody}
          onChange={(event) => setNewCommentBody(event.target.value)}
          rows={3}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        />

        <label htmlFor="mentions" className="text-xs font-medium">
          @メンション（任意）
        </label>
        <select
          id="mentions"
          multiple
          value={mentionUserIds}
          onChange={(event) => {
            const values = Array.from(event.target.selectedOptions).map((option) => option.value);
            setMentionUserIds(values);
          }}
          className="min-h-24 w-full rounded-md border bg-background px-2 py-1 text-sm"
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {mentionLabel(member)} ({member.role})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          コメント内で `@メールアドレス` または `@表示名` を書いても自動でメンションされます。
        </p>

        <Button
          type="button"
          variant="outline"
          disabled={submitting || newCommentBody.trim().length === 0}
          onClick={() =>
            createComment({
              body: newCommentBody,
              parentCommentId: null,
              blockId: selectedBlockId,
              selectedTextValue: selectedText,
            })
          }
        >
          コメント追加
        </Button>
      </section>

      <section className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">コメントを読み込み中...</p>
        ) : (
          availableBlocks.map((blockId) => {
            const blockComments = groupedByBlock.get(blockId) ?? [];
            const rootComments = blockComments.filter((comment) => !comment.parent_comment_id);

            return (
              <div key={blockId} className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">ブロック: {blockId}</p>

                {rootComments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">コメントなし</p>
                ) : (
                  rootComments.map((comment) => {
                    const replies = blockComments.filter(
                      (reply) => reply.parent_comment_id === comment.id,
                    );

                    return (
                      <div key={comment.id} className="space-y-2 rounded-md border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium">{toUserName(comment.author)}</span>
                          <span className="text-muted-foreground">{formatDateTime(comment.created_at)}</span>
                        </div>
                        {comment.selected_text ? (
                          <p className="rounded bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                            引用: {comment.selected_text}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                        {comment.mentioned_user_ids && comment.mentioned_user_ids.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            メンション:{" "}
                            {comment.mentioned_user_ids
                              .map((userId) => {
                                const member = members.find((row) => row.id === userId);
                                if (!member) {
                                  return null;
                                }
                                return `@${mentionLabel(member)}`;
                              })
                              .filter((value): value is string => Boolean(value))
                              .join(", ") || "-"}
                          </p>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={comment.is_resolved ? "secondary" : "outline"}
                            onClick={() => toggleResolved(comment.id, !comment.is_resolved)}
                          >
                            {comment.is_resolved ? "解決済みを解除" : "解決済みにする"}
                          </Button>
                        </div>

                        {replies.length > 0 ? (
                          <div className="space-y-2 border-l pl-3">
                            {replies.map((reply) => (
                              <div key={reply.id} className="rounded border bg-background p-2">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-medium">{toUserName(reply.author)}</span>
                                  <span className="text-muted-foreground">
                                    {formatDateTime(reply.created_at)}
                                  </span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-sm">{reply.body}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <textarea
                            rows={2}
                            value={replyBodies[comment.id] ?? ""}
                            onChange={(event) =>
                              setReplyBodies((prev) => ({
                                ...prev,
                                [comment.id]: event.target.value,
                              }))
                            }
                            placeholder="返信を書く"
                            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              submitting || (replyBodies[comment.id] ?? "").trim().length === 0
                            }
                            onClick={() =>
                              createComment({
                                body: replyBodies[comment.id] ?? "",
                                parentCommentId: comment.id,
                                blockId: comment.block_id,
                                mentionIds: [],
                              })
                            }
                          >
                            返信
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })
        )}
      </section>
    </aside>
  );
}
