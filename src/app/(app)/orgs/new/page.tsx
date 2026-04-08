import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/app/page-shell";
import { createClient } from "@/lib/supabase/server";

function toSlug(input: string) {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createOrganization(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const nameValue = formData.get("name");
  if (typeof nameValue !== "string" || nameValue.trim().length === 0) {
    redirect("/orgs/new?error=組織名を入力してください");
  }

  const generatedSlug = toSlug(nameValue);
  if (!generatedSlug) {
    redirect("/orgs/new?error=英数字を含む組織名を指定してください");
  }

  const slugValue = formData.get("slug");
  const slug =
    typeof slugValue === "string" && slugValue.trim().length > 0
      ? toSlug(slugValue)
      : generatedSlug;

  if (!slug) {
    redirect("/orgs/new?error=有効なslugを入力してください");
  }

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: nameValue.trim(),
      slug,
    })
    .select("id, slug")
    .single();

  if (orgError || !organization) {
    redirect(`/orgs/new?error=${encodeURIComponent(orgError?.message ?? "組織作成に失敗しました")}`);
  }

  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: organization.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    redirect(`/orgs/new?error=${encodeURIComponent(memberError.message)}`);
  }

  redirect(`/orgs/${organization.slug}`);
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await Promise.resolve(searchParams);
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <PageShell
      title="新しい組織を作成"
      description="研究室・医局単位でワークスペースを作成します。"
    >
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form action={createOrganization} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            組織名
          </label>
          <input
            id="name"
            name="name"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="北里大耳鼻科研究室"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="slug" className="text-sm font-medium">
            URL slug（任意）
          </label>
          <input
            id="slug"
            name="slug"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="kitasato-ent-lab"
          />
        </div>
        <Button type="submit">組織を作成</Button>
      </form>
    </PageShell>
  );
}
