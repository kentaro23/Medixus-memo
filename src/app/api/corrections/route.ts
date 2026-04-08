import { NextRequest, NextResponse } from "next/server";

import { extractContextKeywords } from "@/lib/correction-keywords";
import { createClient } from "@/lib/supabase/server";

type CorrectionRequestBody = {
  meetingId?: string;
  organizationId?: string;
  wrongText?: string;
  correctText?: string;
  context?: string;
  isPronunciationVariant?: boolean;
  applyGlobally?: boolean;
  createGlossaryTerm?: boolean;
  termData?: {
    reading?: string;
    definition?: string;
    full_form?: string;
    category?: string;
    detailed_explanation?: string;
  };
};

type ExistingTermRow = {
  id: string;
  pronunciation_variants: string[] | null;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  category: string | null;
  reading: string | null;
};

type CorrectionInsertRow = {
  id: string;
};

type MeetingUpdateRow = {
  corrected_transcript: string | null;
  minutes_markdown: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullable(value: unknown) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function applyLiteralReplace(input: string | null, wrongText: string, correctText: string) {
  if (!input) {
    return input;
  }
  return input.split(wrongText).join(correctText);
}

function mergeUnique(values: string[], nextValue: string) {
  if (!nextValue) {
    return values;
  }
  if (values.includes(nextValue)) {
    return values;
  }
  return [...values, nextValue];
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CorrectionRequestBody | null;

  const meetingId = normalizeText(body?.meetingId);
  const organizationId = normalizeText(body?.organizationId);
  const wrongText = normalizeText(body?.wrongText);
  const correctText = normalizeText(body?.correctText);
  const context = normalizeText(body?.context);
  const isPronunciationVariant = Boolean(body?.isPronunciationVariant);
  const applyGlobally = body?.applyGlobally !== false;
  const createGlossaryTerm = Boolean(body?.createGlossaryTerm);
  const termData = body?.termData ?? {};

  if (!meetingId || !organizationId || !wrongText || !correctText) {
    return NextResponse.json(
      { error: "meetingId, organizationId, wrongText, correctText are required." },
      { status: 400 },
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contextKeywords = await extractContextKeywords({
    context,
    wrongText,
    correctText,
  });

  const { data: correction, error: insertCorrectionError } = await supabase
    .from("transcription_corrections")
    .insert({
      meeting_id: meetingId,
      organization_id: organizationId,
      wrong_text: wrongText,
      correct_text: correctText,
      context: context || null,
      is_pronunciation_variant: isPronunciationVariant,
      context_keywords: contextKeywords,
      apply_globally: applyGlobally,
      created_by: user.id,
    })
    .select("id")
    .single<CorrectionInsertRow>();

  if (insertCorrectionError || !correction) {
    return NextResponse.json(
      { error: `Failed to insert correction: ${insertCorrectionError?.message}` },
      { status: 500 },
    );
  }

  let glossaryTermId: string | null = null;

  if (createGlossaryTerm) {
    const { data: existingTerm } = await supabase
      .from("glossary_terms")
      .select(
        "id, pronunciation_variants, definition, detailed_explanation, full_form, category, reading",
      )
      .eq("organization_id", organizationId)
      .eq("term", correctText)
      .maybeSingle<ExistingTermRow>();

    if (existingTerm) {
      const updates: Record<string, unknown> = {};
      const existingVariants = existingTerm.pronunciation_variants ?? [];

      if (isPronunciationVariant) {
        updates.pronunciation_variants = mergeUnique(existingVariants, wrongText);
      }
      if (!existingTerm.reading && toNullable(termData.reading)) {
        updates.reading = toNullable(termData.reading);
      }
      if (!existingTerm.definition && toNullable(termData.definition)) {
        updates.definition = toNullable(termData.definition);
      }
      if (!existingTerm.detailed_explanation && toNullable(termData.detailed_explanation)) {
        updates.detailed_explanation = toNullable(termData.detailed_explanation);
      }
      if (!existingTerm.full_form && toNullable(termData.full_form)) {
        updates.full_form = toNullable(termData.full_form);
      }
      if (!existingTerm.category && toNullable(termData.category)) {
        updates.category = toNullable(termData.category);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateTermError } = await supabase
          .from("glossary_terms")
          .update(updates)
          .eq("id", existingTerm.id);

        if (updateTermError) {
          return NextResponse.json(
            { error: `Failed to update glossary term: ${updateTermError.message}` },
            { status: 500 },
          );
        }
      }

      glossaryTermId = existingTerm.id;
    } else {
      const { data: newTerm, error: insertTermError } = await supabase
        .from("glossary_terms")
        .insert({
          organization_id: organizationId,
          term: correctText,
          reading: toNullable(termData.reading),
          pronunciation_variants: isPronunciationVariant ? [wrongText] : [],
          definition: toNullable(termData.definition),
          detailed_explanation: toNullable(termData.detailed_explanation),
          full_form: toNullable(termData.full_form),
          category: toNullable(termData.category),
          created_by: user.id,
        })
        .select("id")
        .single<{ id: string }>();

      if (insertTermError || !newTerm) {
        return NextResponse.json(
          { error: `Failed to insert glossary term: ${insertTermError?.message}` },
          { status: 500 },
        );
      }

      glossaryTermId = newTerm.id;
    }

    if (glossaryTermId) {
      await supabase
        .from("transcription_corrections")
        .update({ glossary_term_id: glossaryTermId })
        .eq("id", correction.id);

      await supabase.rpc("increment_term_correction", {
        p_term_id: glossaryTermId,
      });
    }
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("corrected_transcript, minutes_markdown")
    .eq("id", meetingId)
    .maybeSingle<MeetingUpdateRow>();

  if (meeting) {
    await supabase
      .from("meetings")
      .update({
        corrected_transcript: applyLiteralReplace(
          meeting.corrected_transcript,
          wrongText,
          correctText,
        ),
        minutes_markdown: applyLiteralReplace(meeting.minutes_markdown, wrongText, correctText),
      })
      .eq("id", meetingId);
  }

  return NextResponse.json({
    success: true,
    correctionId: correction.id,
    glossaryTermId,
    contextKeywords,
  });
}
