import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Params = {
  token: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  expires_at: string;
  accepted_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type InvitationWithOrg = InvitationRow & {
  organization: OrganizationRow | null;
};

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function redirectWithMessage(token: string, key: string, message: string): never {
  redirect(`/invite/${token}?${key}=${encodeURIComponent(message)}`);
}

async function getInvitationByToken(token: string): Promise<InvitationWithOrg | null> {
  const admin = createAdminClient();
  const { data: invitation, error: invitationError } = await admin
    .from("invitations")
    .select("id, organization_id, email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle<InvitationRow>();

  if (invitationError || !invitation) {
    return null;
  }

  const { data: organization } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("id", invitation.organization_id)
    .maybeSingle<OrganizationRow>();

  return {
    ...invitation,
    organization: organization ?? null,
  };
}

async function acceptInvitationAction(token: string) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation || !invitation.organization) {
    redirectWithMessage(token, "error", "招待リンクが見つかりません。");
  }

  if (invitation.accepted_at) {
    redirect(
      `/orgs/${invitation.organization.slug}?message=${encodeURIComponent("この招待はすでに受諾済みです。")}`,
    );
  }

  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    redirectWithMessage(token, "error", "招待リンクの有効期限が切れています。管理者に再発行を依頼してください。");
  }

  const userEmail = normalizeEmail(user.email);
  const invitedEmail = normalizeEmail(invitation.email);

  if (!userEmail || userEmail !== invitedEmail) {
    redirectWithMessage(
      token,
      "error",
      `招待先メールアドレス（${invitation.email}）でログインしてください。`,
    );
  }

  const admin = createAdminClient();

  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null;

  const { error: profileUpsertError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      full_name: fullName,
      avatar_url: avatarUrl,
    },
    { onConflict: "id" },
  );

  if (profileUpsertError) {
    redirectWithMessage(token, "error", `プロフィール同期に失敗しました: ${profileUpsertError.message}`);
  }

  const { error: memberInsertError } = await admin.from("organization_members").insert({
    organization_id: invitation.organization_id,
    user_id: user.id,
    role: invitation.role,
  });

  if (memberInsertError && memberInsertError.code !== "23505") {
    redirectWithMessage(token, "error", `組織参加に失敗しました: ${memberInsertError.message}`);
  }

  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .is("accepted_at", null);

  redirect(`/orgs/${invitation.organization.slug}?message=${encodeURIComponent("組織に参加しました。")}`);
}

export default async function InviteTokenPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);

  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";
  const info = typeof parsedSearchParams.info === "string" ? parsedSearchParams.info : "";
  const safeNext = `/invite/${token}`;

  const invitation = await getInvitationByToken(token);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!invitation || !invitation.organization) {
    return (
      <section className="rounded-xl border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">組織への招待</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          招待リンクを確認して、対象メールアドレスのアカウントで参加処理を行ってください。
        </p>
        {error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {info}
          </p>
        ) : null}
        <div className="mt-4 space-y-4">
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            招待リンクが無効です。管理者に再発行を依頼してください。
          </p>
          <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            ログイン画面へ
          </Link>
        </div>
      </section>
    );
  }

  const isAccepted = Boolean(invitation.accepted_at);
  const isEmailMatched = !!user && normalizeEmail(user.email) === normalizeEmail(invitation.email);
  const canAccept = !!user && !isAccepted && isEmailMatched;

  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <h1 className="text-xl font-semibold">組織への招待</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        招待リンクを確認して、対象メールアドレスのアカウントで参加処理を行ってください。
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {info}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <dl className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <dt className="text-muted-foreground">組織</dt>
            <dd>{invitation.organization.name}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <dt className="text-muted-foreground">招待メール</dt>
            <dd>{invitation.email}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <dt className="text-muted-foreground">ロール</dt>
            <dd>{invitation.role}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <dt className="text-muted-foreground">有効期限</dt>
            <dd>{new Date(invitation.expires_at).toLocaleString("ja-JP")}</dd>
          </div>
        </dl>

        {!user ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/signup?next=${encodeURIComponent(safeNext)}`}
              className={cn(buttonVariants({ variant: "default" }), "sm:flex-1")}
            >
              新規登録して参加
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(safeNext)}`}
              className={cn(buttonVariants({ variant: "outline" }), "sm:flex-1")}
            >
              ログインして参加
            </Link>
          </div>
        ) : null}

        {user ? (
          <p className="text-sm text-muted-foreground">現在ログイン中: {user.email}</p>
        ) : null}

        {isAccepted ? (
          <Link
            href={`/orgs/${invitation.organization.slug}`}
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
          >
            組織ダッシュボードへ
          </Link>
        ) : null}

        {user && !isEmailMatched ? (
          <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            招待先メールアドレス（{invitation.email}）とは別のアカウントでログイン中です。
          </p>
        ) : null}

        {canAccept ? (
          <form action={acceptInvitationAction.bind(null, token)}>
            <Button type="submit" className="w-full">
              この組織に参加する
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
