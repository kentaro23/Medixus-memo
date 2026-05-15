"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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

function getSafeNextPath(formData: FormData) {
  const value = formData.get("next");
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }
  return value;
}

function toEmailRedirectUrl(nextPath: string) {
  const url = new URL("/auth/callback", getBaseUrl());
  url.searchParams.set("next", nextPath);
  return url.toString();
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

function toFriendlyNetworkError(error: unknown) {
  const message =
    error instanceof Error ? `${error.message} ${(error as { cause?: unknown }).cause ?? ""}` : "";

  if (message.includes("ENOTFOUND")) {
    return "Supabase接続先が見つかりません。環境変数 NEXT_PUBLIC_SUPABASE_URL を確認してください。";
  }

  if (message.includes("fetch failed")) {
    return "Supabaseへの接続に失敗しました。環境変数設定とネットワーク状態を確認してください。";
  }

  return "ログイン処理で通信エラーが発生しました。30秒ほど待って再試行してください。";
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

  let signInErrorMessage = "";
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      signInErrorMessage = toFriendlyAuthError(error.message);
    }
  } catch (error) {
    console.error("[auth] signInWithPassword failed:", error);
    signInErrorMessage = toFriendlyNetworkError(error);
  }

  if (signInErrorMessage) {
    redirectWithMessage("/login", "error", signInErrorMessage);
  }

  redirect(nextPath);
}

export async function signUpAction(formData: FormData) {
  const fullName = normalizeOptionalText(formData.get("fullName"));
  const email = normalizeEmail(formData.get("email"));
  const password = normalizeOptionalText(formData.get("password"));
  const passwordConfirm = normalizeOptionalText(formData.get("passwordConfirm"));
  const nextPath = getSafeNextPath(formData);

  if (!email) {
    redirectWithMessage("/signup", "error", "メールアドレスを入力してください。");
  }

  if (password.length < 8) {
    redirectWithMessage("/signup", "error", "パスワードは8文字以上にしてください。");
  }

  if (password !== passwordConfirm) {
    redirectWithMessage("/signup", "error", "確認用パスワードが一致しません。");
  }

  let signUpResult:
    | {
        session: unknown;
      }
    | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: toEmailRedirectUrl(nextPath),
        data: fullName ? { full_name: fullName } : undefined,
      },
    });

    if (error) {
      redirectWithMessage("/signup", "error", toFriendlyAuthError(error.message));
    }

    signUpResult = { session: data.session };
  } catch (error) {
    console.error("[auth] signUp failed:", error);
    redirectWithMessage("/signup", "error", toFriendlyNetworkError(error));
  }

  if (!signUpResult?.session) {
    redirectWithMessage(
      "/login",
      "message",
      "アカウントを作成しました。確認メールのリンクを開いた後にログインしてください。",
    );
  }

  redirect("/orgs/new");
}
