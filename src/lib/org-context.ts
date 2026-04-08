import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type OrganizationRole = "owner" | "admin" | "member";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type MembershipRow = {
  role: OrganizationRole;
};

export async function requireOrganizationContext({
  orgSlug,
  nextPath,
}: {
  orgSlug: string;
  nextPath: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", orgSlug)
    .maybeSingle<OrganizationRow>();

  if (!organization) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle<MembershipRow>();

  if (!membership) {
    redirect("/");
  }

  return {
    supabase,
    user,
    organization,
    membership,
  };
}
