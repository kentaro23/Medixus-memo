import { randomUUID } from "crypto";
import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Params = { orgSlug: string };
type SearchParams = Record<string, string | string[] | undefined>;
type MemberRow = { user_id: string; role: "owner" | "admin" | "member"; joined_at: string };
type ProfileRow = { id: string; email: string; full_name: string | null };
type OrgMembership = { role: "owner" | "admin" | "member" };
type InvitationRow = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return normalizeText(value).toLowerCase();
}

function isAllowedRole(value: string): value is "admin" | "member" {
  return value === "admin" || value === "member";
}

function parseInviteExpiresDays(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (Number.isNaN(parsed)) {
    return 7;
  }
  return Math.max(1, Math.min(30, parsed));
}

function getBaseUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return appUrl;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

function createInviteToken() {
  return `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
}

function redirectWithParams(orgSlug: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);
  return redirect(`/orgs/${orgSlug}/settings/members?${searchParams.toString()}`);
}

function redirectWithMessage(orgSlug: string, key: string, message: string): never {
  return redirectWithParams(orgSlug, { [key]: message });
}

function toFriendlyAdminError(message: string) {
  if (message.includes("already registered")) {
    return "このメールアドレスは既に存在します。既存ユーザーとして組織追加を試みます。";
  }
  if (message.includes("Password should be at least")) {
    return "初期パスワードは8文字以上にしてください。";
  }
  return message;
}

async function getOrganizationContext(orgSlug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/orgs/${orgSlug}/settings/members`)}`);
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!organization) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle<OrgMembership>();

  if (!membership) {
    redirect("/");
  }

  return {
    supabase,
    organization,
    membership,
  };
}

async function issueMemberAccountAction(orgSlug: string, formData: FormData) {
  "use server";

  const email = normalizeEmail(formData.get("email"));
  const password = normalizeText(formData.get("password"));
  const fullName = normalizeText(formData.get("fullName"));
  const roleInput = normalizeText(formData.get("role"));

  if (!email) {
    redirectWithMessage(orgSlug, "error", "メールアドレスを入力してください。");
  }

  if (password.length < 8) {
    redirectWithMessage(orgSlug, "error", "初期パスワードは8文字以上にしてください。");
  }

  if (!isAllowedRole(roleInput)) {
    redirectWithMessage(orgSlug, "error", "ロールは admin または member を指定してください。");
  }

  const { supabase, organization, membership } = await getOrganizationContext(orgSlug);

  if (membership.role !== "owner" && membership.role !== "admin") {
    redirectWithMessage(orgSlug, "error", "この操作を実行する権限がありません。");
  }

  const admin = createAdminClient();

  let targetUserId: string | null = null;
  let createdNewUser = false;

  const { data: createdUserData, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (createUserError) {
    const maybeAlreadyExists = /already|registered|exists/i.test(createUserError.message);

    if (!maybeAlreadyExists) {
      redirectWithMessage(orgSlug, "error", toFriendlyAdminError(createUserError.message));
    }

    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle<{ id: string }>();

    if (profileLookupError || !existingProfile?.id) {
      redirectWithMessage(
        orgSlug,
        "error",
        "既存ユーザーを特定できませんでした。メールアドレスを確認してください。",
      );
    }

    targetUserId = existingProfile.id;
  } else {
    targetUserId = createdUserData.user.id;
    createdNewUser = true;
  }

  if (!targetUserId) {
    redirectWithMessage(orgSlug, "error", "ユーザー作成に失敗しました。");
  }

  const { error: profileUpsertError } = await admin.from("profiles").upsert(
    {
      id: targetUserId,
      email,
      full_name: fullName || null,
    },
    {
      onConflict: "id",
    },
  );

  if (profileUpsertError) {
    if (createdNewUser) {
      await admin.auth.admin.deleteUser(targetUserId, false);
    }
    redirectWithMessage(orgSlug, "error", `プロフィール更新に失敗しました: ${profileUpsertError.message}`);
  }

  const { error: memberInsertError } = await supabase.from("organization_members").insert({
    organization_id: organization.id,
    user_id: targetUserId,
    role: roleInput,
  });

  if (memberInsertError) {
    if (memberInsertError.code === "23505") {
      redirectWithMessage(orgSlug, "info", "このユーザーは既に組織メンバーです。");
    }

    if (createdNewUser) {
      await admin.auth.admin.deleteUser(targetUserId, false);
    }

    redirectWithMessage(orgSlug, "error", `メンバー追加に失敗しました: ${memberInsertError.message}`);
  }

  redirectWithMessage(orgSlug, "success", `${email} のアカウントを発行して組織に追加しました。`);
}

async function createInvitationAction(orgSlug: string, formData: FormData) {
  "use server";

  const inviteEmail = normalizeEmail(formData.get("inviteEmail"));
  const inviteRole = normalizeText(formData.get("inviteRole"));
  const expiresInDays = parseInviteExpiresDays(formData.get("inviteExpiresDays"));

  if (!inviteEmail) {
    redirectWithMessage(orgSlug, "error", "招待先メールアドレスを入力してください。");
  }

  if (!isAllowedRole(inviteRole)) {
    redirectWithMessage(orgSlug, "error", "招待ロールは admin または member を指定してください。");
  }

  const { supabase, organization, membership } = await getOrganizationContext(orgSlug);

  if (membership.role !== "owner" && membership.role !== "admin") {
    redirectWithMessage(orgSlug, "error", "この操作を実行する権限がありません。");
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  let createdToken: string | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createInviteToken();
    const { data: invitation, error: invitationError } = await supabase
      .from("invitations")
      .insert({
        organization_id: organization.id,
        email: inviteEmail,
        role: inviteRole,
        token,
        expires_at: expiresAt,
      })
      .select("token")
      .single<{ token: string }>();

    if (!invitationError && invitation) {
      createdToken = invitation.token;
      break;
    }

    if (invitationError?.code !== "23505") {
      redirectWithMessage(orgSlug, "error", `招待作成に失敗しました: ${invitationError?.message}`);
    }
  }

  if (!createdToken) {
    redirectWithMessage(orgSlug, "error", "招待トークン生成に失敗しました。もう一度お試しください。");
  }

  const inviteUrl = `${getBaseUrl()}/invite/${createdToken}`;
  redirectWithParams(orgSlug, {
    success: `${inviteEmail} 宛ての招待リンクを作成しました。`,
    invite: inviteUrl,
  });
}

function invitationStatusLabel(invitation: InvitationRow) {
  if (invitation.accepted_at) {
    return "受諾済み";
  }
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    return "期限切れ";
  }
  return "有効";
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await Promise.resolve(params);
  const parsedSearchParams = await Promise.resolve(searchParams);

  const { supabase, organization, membership } = await getOrganizationContext(orgSlug);

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("user_id, role, joined_at")
    .eq("organization_id", organization.id)
    .order("joined_at", { ascending: true });

  const { data: invitationRows } = await supabase
    .from("invitations")
    .select("id, email, role, token, expires_at, accepted_at, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const members = (memberRows ?? []) as MemberRow[];
  const invitations = (invitationRows ?? []) as InvitationRow[];
  const userIds = members.map((member) => member.user_id);

  let profileMap = new Map<string, ProfileRow>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", userIds);
    profileMap = new Map((profiles as ProfileRow[] | null | undefined)?.map((profile) => [profile.id, profile]));
  }

  const canManage = membership.role === "owner" || membership.role === "admin";
  const appBaseUrl = getBaseUrl();

  const error = typeof parsedSearchParams.error === "string" ? parsedSearchParams.error : "";
  const success = typeof parsedSearchParams.success === "string" ? parsedSearchParams.success : "";
  const info = typeof parsedSearchParams.info === "string" ? parsedSearchParams.info : "";
  const inviteUrl = typeof parsedSearchParams.invite === "string" ? parsedSearchParams.invite : "";

  return (
    <PageShell
      title="メンバー管理"
      description="代表者・管理者が、アカウント発行または招待リンクで組織へ参加させられます。"
      orgSlug={orgSlug}
    >
      {!canManage ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          このページを編集する権限がありません。
        </p>
      ) : (
        <div className="space-y-4">
          <form action={issueMemberAccountAction.bind(null, orgSlug)} className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">新規アカウント発行</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="issue-email" className="text-sm font-medium">
                  メールアドレス
                </label>
                <input
                  id="issue-email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="member@example.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="issue-password" className="text-sm font-medium">
                  初期パスワード（8文字以上）
                </label>
                <input
                  id="issue-password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="********"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="issue-fullName" className="text-sm font-medium">
                  氏名（任意）
                </label>
                <input
                  id="issue-fullName"
                  name="fullName"
                  type="text"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="藤岡 先生"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="issue-role" className="text-sm font-medium">
                  ロール
                </label>
                <select
                  id="issue-role"
                  name="role"
                  defaultValue="member"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              発行した初期パスワードは安全な方法で本人に共有し、初回ログイン後に変更するよう案内してください。
            </p>

            <Button type="submit">アカウントを発行して追加</Button>
          </form>

          <form action={createInvitationAction.bind(null, orgSlug)} className="space-y-4 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">招待リンク発行（自己登録フロー）</h2>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="invite-email" className="text-sm font-medium">
                  招待先メールアドレス
                </label>
                <input
                  id="invite-email"
                  name="inviteEmail"
                  type="email"
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="member@example.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="invite-role" className="text-sm font-medium">
                  ロール
                </label>
                <select
                  id="invite-role"
                  name="inviteRole"
                  defaultValue="member"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="invite-expires" className="text-sm font-medium">
                  有効期限（日）
                </label>
                <input
                  id="invite-expires"
                  name="inviteExpiresDays"
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={7}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <Button type="submit" variant="outline">
              招待リンクを発行
            </Button>
          </form>
        </div>
      )}

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
      {info ? (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {info}
        </p>
      ) : null}
      {inviteUrl ? (
        <div className="space-y-2 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p>発行した招待URL</p>
          <a href={inviteUrl} className="break-all underline" target="_blank" rel="noreferrer">
            {inviteUrl}
          </a>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">現在のメンバー</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">メンバーはまだ登録されていません。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">氏名</th>
                  <th className="px-3 py-2 font-medium">メール</th>
                  <th className="px-3 py-2 font-medium">ロール</th>
                  <th className="px-3 py-2 font-medium">参加日時</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const profile = profileMap.get(member.user_id);
                  return (
                    <tr key={member.user_id} className="border-t">
                      <td className="px-3 py-2">{profile?.full_name ?? "-"}</td>
                      <td className="px-3 py-2">{profile?.email ?? "-"}</td>
                      <td className="px-3 py-2">{member.role}</td>
                      <td className="px-3 py-2">{new Date(member.joined_at).toLocaleString("ja-JP")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">招待一覧</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ招待は発行されていません。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">メール</th>
                  <th className="px-3 py-2 font-medium">ロール</th>
                  <th className="px-3 py-2 font-medium">状態</th>
                  <th className="px-3 py-2 font-medium">有効期限</th>
                  <th className="px-3 py-2 font-medium">招待URL</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const invitationUrl = `${appBaseUrl}/invite/${invitation.token}`;
                  return (
                    <tr key={invitation.id} className="border-t">
                      <td className="px-3 py-2">{invitation.email}</td>
                      <td className="px-3 py-2">{invitation.role}</td>
                      <td className="px-3 py-2">{invitationStatusLabel(invitation)}</td>
                      <td className="px-3 py-2">{new Date(invitation.expires_at).toLocaleString("ja-JP")}</td>
                      <td className="px-3 py-2">
                        <a href={invitationUrl} className="break-all underline" target="_blank" rel="noreferrer">
                          {invitationUrl}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
