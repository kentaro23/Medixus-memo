import { NextRequest, NextResponse } from "next/server";

import { extractContextKeywords } from "@/lib/correction-keywords";
import { createClient } from "@/lib/supabase/server";

type Body = {
  context?: string;
  wrongText?: string;
  correctText?: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const context = body?.context?.trim() ?? "";
  const wrongText = body?.wrongText?.trim() ?? "";
  const correctText = body?.correctText?.trim() ?? "";

  if (!context || !wrongText || !correctText) {
    return NextResponse.json(
      { error: "context, wrongText, correctText are required." },
      { status: 400 },
    );
  }

  const keywords = await extractContextKeywords({
    context,
    wrongText,
    correctText,
  });

  return NextResponse.json({ keywords });
}
