import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type OrganizationSummary = {
  slug: string;
};

type MembershipRow = {
  organizations: OrganizationSummary | OrganizationSummary[] | null;
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organizations(slug)")
    .eq("user_id", user.id)
    .limit(1);

  const firstMembership = (memberships?.[0] ?? null) as MembershipRow | null;
  const organization = Array.isArray(firstMembership?.organizations)
    ? firstMembership?.organizations[0]
    : firstMembership?.organizations;

  if (!organization?.slug) {
    redirect("/orgs/new");
  }

  redirect(`/orgs/${organization.slug}`);
}
