import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

import { signOutAction } from "./actions";

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

type MembershipRow = {
  role: "owner" | "admin" | "member";
  organizations: OrganizationSummary | OrganizationSummary[] | null;
};

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  const organizationLinks = ((memberships ?? []) as MembershipRow[])
    .map((membership) =>
      Array.isArray(membership.organizations)
        ? membership.organizations[0]
        : membership.organizations,
    )
    .filter((organization): organization is OrganizationSummary =>
      Boolean(organization && organization.slug),
    );

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Medixus Minutes
            </Link>
            <div className="flex flex-wrap gap-2 text-xs">
              {organizationLinks.map((organization) => (
                <Link
                  key={organization.id}
                  href={`/orgs/${organization.slug}`}
                  className="rounded-md border px-2 py-1 hover:bg-muted"
                >
                  {organization.name}
                </Link>
              ))}
              <Link href="/orgs/new" className="rounded-md border px-2 py-1 hover:bg-muted">
                + 組織を作成
              </Link>
            </div>
          </div>

          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              ログアウト
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
