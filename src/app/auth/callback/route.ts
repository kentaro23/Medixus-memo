import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "magiclink", "invite", "recovery", "email", "email_change"];

function sanitizeNext(nextValue: string | null) {
  if (!nextValue || !nextValue.startsWith("/")) {
    return "/";
  }
  return nextValue;
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  if (!value) {
    return false;
  }
  return OTP_TYPES.includes(value as EmailOtpType);
}

async function syncProfileFromUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null },
) {
  if (!user.email) {
    return;
  }

  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null;

  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: fullName,
    avatar_url: avatarUrl,
  });
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash") ?? requestUrl.searchParams.get("token");
  const rawType = requestUrl.searchParams.get("type");
  const next = sanitizeNext(requestUrl.searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;
      if (user) {
        await syncProfileFromUser(supabase, user);
      }

      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  if (tokenHash) {
    const candidateTypes: EmailOtpType[] = [];

    if (isEmailOtpType(rawType)) {
      candidateTypes.push(rawType);
    }

    for (const fallbackType of OTP_TYPES) {
      if (!candidateTypes.includes(fallbackType)) {
        candidateTypes.push(fallbackType);
      }
    }

    for (const candidateType of candidateTypes) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: candidateType,
      });

      if (error) {
        continue;
      }

      const user = data.user;
      if (user) {
        await syncProfileFromUser(supabase, user);
      }

      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url));
}
