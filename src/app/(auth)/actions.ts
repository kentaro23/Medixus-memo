"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getSafeNextPath(formData: FormData) {
  const value = formData.get("next");
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }
  return value;
}

function redirectWithMessage(path: string, key: string, message: string) {
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

function toEmailRedirectUrl(nextPath: string) {
  const url = new URL("/auth/callback", getBaseUrl());
  url.searchParams.set("next", nextPath);
  return url.toString();
}

export async function signInAction(formData: FormData) {
  const emailValue = formData.get("email");
  const nextPath = getSafeNextPath(formData);

  if (typeof emailValue !== "string" || emailValue.length === 0) {
    redirectWithMessage("/login", "error", "メールアドレスを入力してください。");
    return;
  }
  const email = emailValue;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: toEmailRedirectUrl(nextPath),
    },
  });

  if (error) {
    redirectWithMessage("/login", "error", error.message);
  }

  redirect(`/login?sent=1&email=${encodeURIComponent(email)}`);
}

export async function signUpAction(formData: FormData) {
  const emailValue = formData.get("email");
  const fullName = formData.get("fullName");
  const nextPath = getSafeNextPath(formData);

  if (typeof emailValue !== "string" || emailValue.length === 0) {
    redirectWithMessage("/signup", "error", "メールアドレスを入力してください。");
    return;
  }
  const email = emailValue;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: toEmailRedirectUrl(nextPath),
      data: typeof fullName === "string" && fullName.length > 0 ? { full_name: fullName } : undefined,
    },
  });

  if (error) {
    redirectWithMessage("/signup", "error", error.message);
  }

  redirect(`/signup?sent=1&email=${encodeURIComponent(email)}`);
}
