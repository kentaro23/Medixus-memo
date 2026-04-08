"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/config";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (client) {
    return client;
  }

  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}
