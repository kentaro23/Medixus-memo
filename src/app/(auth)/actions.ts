"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getSafeNextPath(formData: FormData) {
  const value = formData.get("next");
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }
  return value;
}

function redirectWithMessage(path: string, key: string, message: string): never {
  return redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function toFriendlyAuthError(message: string) {
  if (message.includes("Invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (message.includes("Email not confirmed")) {
    return "メール確認が完了していません。受信メールを確認してください。";
  }
  if (message.includes("already registered")) {
    return "このメールアドレスは既に登録されています。ログインしてください。";
  }
  if (message.includes("Password should be at least")) {
    return "パスワードは8文字以上にしてください。";
  }
  return message;
}

export async function signInAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  const password = normalizeOptionalText(formData.get("password"));
  const nextPath = getSafeNextPath(formData);

  if (!email) {
    redirectWithMessage("/login", "error", "メールアドレスを入力してください。");
  }

  if (!password) {
    redirectWithMessage("/login", "error", "パスワードを入力してください。");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectWithMessage("/login", "error", toFriendlyAuthError(error.message));
  }

  redirect(nextPath);
}

export async function signUpAction(formData: FormData) {
  const fullName = normalizeOptionalText(formData.get("fullName"));
  const email = normalizeEmail(formData.get("email"));
  const password = normalizeOptionalText(formData.get("password"));
  const passwordConfirm = normalizeOptionalText(formData.get("passwordConfirm"));

  if (!email) {
    redirectWithMessage("/signup", "error", "メールアドレスを入力してください。");
  }

  if (password.length < 8) {
    redirectWithMessage("/signup", "error", "パスワードは8文字以上にしてください。");
  }

  if (password !== passwordConfirm) {
    redirectWithMessage("/signup", "error", "確認用パスワードが一致しません。");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
    },
  });

  if (error) {
    redirectWithMessage("/signup", "error", toFriendlyAuthError(error.message));
  }

  if (!data.session) {
    redirectWithMessage(
      "/login",
      "message",
      "アカウントを作成しました。メール確認後にログインしてください。",
    );
  }

  redirect("/orgs/new");
}
