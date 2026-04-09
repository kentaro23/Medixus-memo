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
  id: string;
  corrected_transcript: string | null;
  minutes_markdown: string | null;
  new_term_candidates: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullable(value: unknown) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiToken(text: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text);
}

function buildSafeCorrectionRegex(wrongText: string) {
  const escaped = escapeRegex(wrongText);

  if (isAsciiToken(wrongText)) {
    return new RegExp(`\\b${escaped}\\b`, "g");
  }

  if (/^[ァ-ヶー]+$/.test(wrongText)) {
    return new RegExp(`(?<![ァ-ヶー])${escaped}(?![ァ-ヶー])`, "g");
  }

  if (/^[ぁ-んー]+$/.test(wrongText)) {
    return new RegExp(`(?<![ぁ-んー])${escaped}(?![ぁ-んー])`, "g");
  }

  if (/^[一-龠々]+$/.test(wrongText)) {
    return new RegExp(`(?<![一-龠々])${escaped}(?![一-龠々])`, "g");
  }

  return new RegExp(escaped, "g");
}

function applySafeReplace(input: string | null, wrongText: string, correctText: string) {
  if (!input) {
    return input;
  }

  return input.replace(buildSafeCorrectionRegex(wrongText), correctText);
}

function removeResolvedCandidate(rawCandidates: unknown, wrongText: string, correctText: string) {
  if (!Array.isArray(rawCandidates)) {
    return rawCandidates;
  }

  const normalizedWrong = normalizeText(wrongText).toLowerCase();
  const normalizedCorrect = normalizeText(correctText).toLowerCase();

  const filtered = rawCandidates.filter((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return true;
    }

    const row = candidate as Record<string, unknown>;
    const term = normalizeText(typeof row.term === "string" ? row.term : "").toLowerCase();
    const heardText = normalizeText(
      typeof row.heard_text === "string" ? row.heard_text : "",
    ).toLowerCase();

    return !(
      term === normalizedWrong ||
      term === normalizedCorrect ||
      heardText === normalizedWrong ||
      heardText === normalizedCorrect
    );
  });

  return filtered;
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

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, corrected_transcript, minutes_markdown, new_term_candidates")
    .eq("organization_id", organizationId);

  let updatedMeetings = 0;

  for (const meeting of (meetings ?? []) as MeetingUpdateRow[]) {
    if (!applyGlobally && meeting.id !== meetingId) {
      continue;
    }

    const nextCorrectedTranscript = applySafeReplace(
      meeting.corrected_transcript,
      wrongText,
      correctText,
    );
    const nextMinutesMarkdown = applySafeReplace(
      meeting.minutes_markdown,
      wrongText,
      correctText,
    );
    const nextCandidates =
      meeting.id === meetingId
        ? removeResolvedCandidate(meeting.new_term_candidates, wrongText, correctText)
        : meeting.new_term_candidates;

    if (
      nextCorrectedTranscript === meeting.corrected_transcript &&
      nextMinutesMarkdown === meeting.minutes_markdown &&
      nextCandidates === meeting.new_term_candidates
    ) {
      continue;
    }

    const { error: updateMeetingError } = await supabase
      .from("meetings")
      .update({
        corrected_transcript: nextCorrectedTranscript,
        minutes_markdown: nextMinutesMarkdown,
        new_term_candidates: nextCandidates,
      })
      .eq("id", meeting.id);

    if (!updateMeetingError) {
      updatedMeetings += 1;
    }
  }

  return NextResponse.json({
    success: true,
    correctionId: correction.id,
    glossaryTermId,
    contextKeywords,
    updatedMeetings,
  });
}
