import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type Params = {
  organizationId: string;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

type MembershipRow = {
  user_id: string;
  role: "owner" | "admin" | "member";
  profiles: ProfileRow | ProfileRow[] | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { organizationId } = await Promise.resolve(params);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentMembership } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!currentMembership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: memberRows, error } = await supabase
    .from("organization_members")
    .select("user_id, role, profiles(id, email, full_name, avatar_url)")
    .eq("organization_id", organizationId)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const members = ((memberRows ?? []) as MembershipRow[])
    .map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      if (!profile) {
        return null;
      }
      return {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        role: row.role,
      };
    })
    .filter((member) => Boolean(member));

  return NextResponse.json({ members });
}
