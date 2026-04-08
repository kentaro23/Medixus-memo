import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

function sanitizeNext(nextValue: string | null) {
  if (!nextValue || !nextValue.startsWith("/")) {
    return "/";
  }
  return nextValue;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNext(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;
      if (user?.email) {
        const fullName =
          typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
        const avatarUrl =
          typeof user.user_metadata?.avatar_url === "string"
            ? user.user_metadata.avatar_url
            : null;

        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          avatar_url: avatarUrl,
        });
      }

      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url));
}
