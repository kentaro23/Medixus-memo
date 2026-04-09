import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type MeetingTranscriptionRow = {
  id: string;
  organization_id: string;
  audio_url: string | null;
};

type GlossaryPromptTermRow = {
  term: string;
  reading: string | null;
  pronunciation_variants: string[] | null;
};

type CorrectionRow = {
  wrong_text: string;
  correct_text: string;
  context_keywords: string[] | null;
};

type MeetingGenerationRow = {
  id: string;
  organization_id: string;
  corrected_transcript: string | null;
  llm_used: string | null;
};

type OrganizationLlmRow = {
  default_llm: string;
};

type GlossaryGenerationTermRow = {
  id: string;
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  aliases: string[] | null;
};

type MinutesSection = {
  block_id: string;
  heading: string;
  content: string;
};

type MinutesItem = {
  text: string;
  owner: string | null;
  due: string | null;
};

type OpenQuestion = {
  text: string;
};

type DetectedTerm = {
  term: string;
  context: string;
};

type NewTermCandidate = {
  term: string;
  guess_full_form: string | null;
  guess_definition: string | null;
  guess_category: string | null;
};

export type GeneratedMinutesPayload = {
  title: string;
  summary: string;
  sections: MinutesSection[];
  decisions: MinutesItem[];
  todos: MinutesItem[];
  open_questions: OpenQuestion[];
  detected_terms: DetectedTerm[];
  new_term_candidates: NewTermCandidate[];
};

type GenerateMinutesOptions = {
  adminClient?: AdminClient;
};

const MAX_WHISPER_PROMPT_LENGTH = 800;
const WHISPER_SAFE_FILE_BYTES = 24 * 1024 * 1024;
const WHISPER_SEGMENT_SECONDS = 20 * 60;
const WHISPER_SEGMENT_MIME_TYPE = "audio/mp4";

type WhisperTranscription = Awaited<ReturnType<OpenAI["audio"]["transcriptions"]["create"]>>;
type SegmentedAudioFile = {
  filename: string;
  buffer: Buffer;
  mimeType: string;
};

let cachedFfmpegExecutable: string | null | undefined;

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function formatMiB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function isWhisperPayloadLimitError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("maximum content size limit") ||
    normalized.includes("content size limit") ||
    normalized.includes("status code 413") ||
    normalized.includes(" 413:")
  );
}

function getDurationFromWhisperTranscription(transcription: WhisperTranscription) {
  if (!transcription || typeof transcription !== "object") {
    return 0;
  }

  if ("duration" in transcription && typeof transcription.duration === "number") {
    return transcription.duration;
  }

  return 0;
}

function resolveFfmpegExecutable() {
  if (cachedFfmpegExecutable !== undefined) {
    return cachedFfmpegExecutable;
  }

  const envConfigured = process.env.FFMPEG_PATH?.trim();
  if (envConfigured) {
    cachedFfmpegExecutable = envConfigured;
    return cachedFfmpegExecutable;
  }

  try {
    const require = createRequire(import.meta.url);
    const resolved = require("ffmpeg-static") as string | null;
    cachedFfmpegExecutable = resolved;
    return cachedFfmpegExecutable;
  } catch {
    cachedFfmpegExecutable = null;
    return cachedFfmpegExecutable;
  }
}

function getExtensionFromAudioPath(audioPath: string) {
  const basename = path.basename(audioPath);
  const index = basename.lastIndexOf(".");
  if (index === -1) {
    return ".wav";
  }

  const extension = basename.slice(index).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(extension)) {
    return extension;
  }

  return ".wav";
}

async function runFfmpeg(args: string[]) {
  const executable = resolveFfmpegExecutable();

  if (!executable) {
    throw new Error(
      "サーバー側の音声分割エンジン(ffmpeg)が利用できません。音声を24MB以下に分割して再実行してください。",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            "サーバー側でffmpeg実行ファイルを見つけられませんでした。しばらく待って再試行してください。",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg segmentation failed (code=${code}): ${stderr.trim() || "unknown error"}`,
        ),
      );
    });
  });
}

async function segmentAudioForWhisper(audioBlob: Blob, extension: string) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "medixus-whisper-"));

  try {
    const inputPath = path.join(tempDirectory, `input${extension || ".wav"}`);
    const outputPattern = path.join(tempDirectory, "segment-%03d.m4a");

    const inputBuffer = Buffer.from(await audioBlob.arrayBuffer());
    await writeFile(inputPath, inputBuffer);

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "aac",
      "-b:a",
      "48k",
      "-f",
      "segment",
      "-segment_time",
      String(WHISPER_SEGMENT_SECONDS),
      "-reset_timestamps",
      "1",
      outputPattern,
    ]);

    const entries = await readdir(tempDirectory);
    const segmentNames = entries
      .filter((entry) => /^segment-\d{3}\.m4a$/i.test(entry))
      .sort((left, right) => left.localeCompare(right));

    if (segmentNames.length === 0) {
      throw new Error(
        "音声ファイルの分割に失敗しました。元音声をMP3/M4Aに変換して再度アップロードしてください。",
      );
    }

    const segments: SegmentedAudioFile[] = [];
    for (const segmentName of segmentNames) {
      const filePath = path.join(tempDirectory, segmentName);
      const buffer = await readFile(filePath);
      segments.push({
        filename: segmentName,
        buffer,
        mimeType: WHISPER_SEGMENT_MIME_TYPE,
      });
    }

    return segments;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function transcribeWithWhisper({
  openai,
  fileBuffer,
  filename,
  mimeType,
  prompt,
}: {
  openai: OpenAI;
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  prompt: string;
}) {
  const uploadFile = await toFile(fileBuffer, filename, { type: mimeType });

  let transcription: WhisperTranscription;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: uploadFile,
      model: "whisper-1",
      language: "ja",
      prompt,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isWhisperPayloadLimitError(message)) {
      throw new Error(
        "Whisper APIのサイズ上限に達しました。音声をさらに短く分割するか、低ビットレートに圧縮してください。",
      );
    }
    throw error;
  }

  let text = "";
  if (typeof transcription === "string") {
    text = transcription;
  } else if (
    transcription &&
    typeof transcription === "object" &&
    "text" in transcription &&
    typeof transcription.text === "string"
  ) {
    text = transcription.text;
  }

  return {
    text: text.trim(),
    durationSeconds: getDurationFromWhisperTranscription(transcription),
  };
}

function normalizeWhisperPromptTerms(terms: GlossaryPromptTermRow[]) {
  const prompt = terms
    .map((term) => {
      const readings = [term.reading, ...(term.pronunciation_variants ?? []).slice(0, 3)].filter(
        Boolean,
      ) as string[];

      if (readings.length === 0) {
        return term.term;
      }

      return `${term.term}(${readings.join("・")})`;
    })
    .join("、");

  if (prompt.length <= MAX_WHISPER_PROMPT_LENGTH) {
    return prompt;
  }

  return prompt.slice(0, MAX_WHISPER_PROMPT_LENGTH);
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCorrections(transcript: string, corrections: CorrectionRow[]) {
  let result = transcript;

  for (const correction of corrections) {
    if (!correction.wrong_text || !correction.correct_text) {
      continue;
    }

    const escapedWrongText = escapeRegex(correction.wrong_text);

    if (correction.context_keywords && correction.context_keywords.length > 0) {
      const contextRegex = new RegExp(`(.{0,80})${escapedWrongText}(.{0,80})`, "g");

      result = result.replace(contextRegex, (fullMatch, before, after) => {
        const surrounding = `${before}${after}`;
        const hasMatchedKeyword = correction.context_keywords?.some((keyword) =>
          surrounding.includes(keyword),
        );

        if (!hasMatchedKeyword) {
          return fullMatch;
        }

        return `${before}${correction.correct_text}${after}`;
      });
      continue;
    }

    result = result.replace(new RegExp(escapedWrongText, "g"), correction.correct_text);
  }

  return result;
}

function getJsonObjectText(rawText: string) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  if (!cleaned) {
    throw new Error("LLM response is empty.");
  }

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("LLM response does not contain a valid JSON object.");
    }

    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    JSON.parse(candidate);
    return candidate;
  }
}

function toStringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableString(value: unknown) {
  const normalized = toStringOrEmpty(value);
  return normalized ? normalized : null;
}

function toMinutesItem(value: unknown): MinutesItem {
  if (!value || typeof value !== "object") {
    return { text: "", owner: null, due: null };
  }
  const row = value as Record<string, unknown>;
  return {
    text: toStringOrEmpty(row.text),
    owner: toNullableString(row.owner),
    due: toNullableString(row.due),
  };
}

function normalizeGeneratedMinutesPayload(raw: unknown): GeneratedMinutesPayload {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const rawSections = Array.isArray(data.sections) ? data.sections : [];
  const sections: MinutesSection[] = rawSections
    .map((section, index) => {
      const row = section && typeof section === "object" ? (section as Record<string, unknown>) : {};
      const heading = toStringOrEmpty(row.heading) || `議題${index + 1}`;
      const content = toStringOrEmpty(row.content);
      const blockId = toStringOrEmpty(row.block_id) || `section-${index + 1}`;
      return {
        block_id: blockId,
        heading,
        content,
      };
    })
    .filter((section) => section.heading.length > 0 || section.content.length > 0);

  const rawDecisions = Array.isArray(data.decisions) ? data.decisions : [];
  const decisions = rawDecisions.map(toMinutesItem).filter((item) => item.text.length > 0);

  const rawTodos = Array.isArray(data.todos) ? data.todos : [];
  const todos = rawTodos.map(toMinutesItem).filter((item) => item.text.length > 0);

  const rawOpenQuestions = Array.isArray(data.open_questions) ? data.open_questions : [];
  const openQuestions = rawOpenQuestions
    .map((question) => {
      const row =
        question && typeof question === "object" ? (question as Record<string, unknown>) : {};
      return { text: toStringOrEmpty(row.text) };
    })
    .filter((question) => question.text.length > 0);

  const rawDetectedTerms = Array.isArray(data.detected_terms) ? data.detected_terms : [];
  const detectedTerms = rawDetectedTerms
    .map((term) => {
      const row = term && typeof term === "object" ? (term as Record<string, unknown>) : {};
      return {
        term: toStringOrEmpty(row.term),
        context: toStringOrEmpty(row.context),
      };
    })
    .filter((term) => term.term.length > 0);

  const rawNewCandidates = Array.isArray(data.new_term_candidates) ? data.new_term_candidates : [];
  const newTermCandidates = rawNewCandidates
    .map((candidate) => {
      const row =
        candidate && typeof candidate === "object"
          ? (candidate as Record<string, unknown>)
          : {};
      return {
        term: toStringOrEmpty(row.term),
        guess_full_form: toNullableString(row.guess_full_form),
        guess_definition: toNullableString(row.guess_definition),
        guess_category: toNullableString(row.guess_category),
      };
    })
    .filter((candidate) => candidate.term.length > 0);

  return {
    title: toStringOrEmpty(data.title) || "会議議事録",
    summary: toStringOrEmpty(data.summary),
    sections,
    decisions,
    todos,
    open_questions: openQuestions,
    detected_terms: detectedTerms,
    new_term_candidates: newTermCandidates,
  };
}

function renderMinutesMarkdown(parsed: GeneratedMinutesPayload) {
  const sectionsPart = parsed.sections
    .map((section) => `<!-- block:${section.block_id} -->\n## ${section.heading}\n${section.content}`)
    .join("\n\n");

  const decisionsPart = parsed.decisions
    .map((decision, index) => {
      const owner = decision.owner ? `（担当: ${decision.owner}）` : "";
      const due = decision.due ? `（期日: ${decision.due}）` : "";
      return `- <!-- block:decision-${index} -->${decision.text}${owner}${due}`;
    })
    .join("\n");

  const todosPart = parsed.todos
    .map((todo, index) => {
      const owner = todo.owner ? `（担当: ${todo.owner}）` : "";
      const due = todo.due ? `（期日: ${todo.due}）` : "";
      return `- [ ] <!-- block:todo-${index} -->${todo.text}${owner}${due}`;
    })
    .join("\n");

  const openQuestionsPart = parsed.open_questions
    .map((question, index) => `- <!-- block:question-${index} -->${question.text}`)
    .join("\n");

  const detectedTermsPart = parsed.detected_terms
    .map((term) => `- **{{term:${term.term}}}**: ${term.context}`)
    .join("\n");

  const newTermsPart = parsed.new_term_candidates
    .map((candidate) => {
      const fullForm = candidate.guess_full_form ? `（${candidate.guess_full_form}）` : "";
      const definition = candidate.guess_definition ?? "";
      return `- **${candidate.term}**${fullForm}: ${definition}`;
    })
    .join("\n");

  return `# ${parsed.title}

<!-- block:summary -->
## サマリー
${parsed.summary}

${sectionsPart}

<!-- block:decisions -->
## 決定事項
${decisionsPart || "- なし"}

<!-- block:todos -->
## ToDo
${todosPart || "- なし"}

<!-- block:open-questions -->
## 未解決論点
${openQuestionsPart || "- なし"}

<!-- block:detected-terms -->
## 専門用語
${detectedTermsPart || "- なし"}

<!-- block:new-terms -->
## 新出用語候補（辞書追加検討）
${newTermsPart || "- なし"}
`;
}

function buildSystemPrompt(glossaryText: string) {
  return `あなたは医療・研究現場の議事録作成専門アシスタントです。
以下の専門用語辞書を踏まえて、文字起こしから構造化された議事録を作成してください。

【組織の専門用語辞書】
${glossaryText}

【出力要件】
1. 文中で専門用語が登場したら必ず {{term:正式表記}} の記法でマークしてください
2. 辞書にない専門用語が登場したら new_term_candidates に含めてください
3. 略語の正式名称や読み方が分かる場合は、新出用語の guess_definition に記載
4. 略語が出てきたら detected_terms に必ず含めてください

【出力フォーマット（JSON）】
{
  "title": "会議タイトル（推定）",
  "summary": "300字以内の全体サマリー（{{term:XXX}}記法使用可）",
  "sections": [
    {
      "block_id": "section-1",
      "heading": "議題1",
      "content": "議論内容（Markdown、{{term:XXX}}記法使用可）"
    }
  ],
  "decisions": [
    { "text": "決定事項", "owner": "担当者 or null", "due": "期日 or null" }
  ],
  "todos": [
    { "text": "ToDo", "owner": "担当者 or null", "due": "期日 or null" }
  ],
  "open_questions": [
    { "text": "未解決論点" }
  ],
  "detected_terms": [
    { "term": "辞書にあった用語", "context": "登場文脈" }
  ],
  "new_term_candidates": [
    {
      "term": "新出専門用語",
      "guess_full_form": "推定正式名称",
      "guess_definition": "推定意味",
      "guess_category": "遺伝子/疾患名/略語/薬剤/手技/その他"
    }
  ]
}

【重要】
- JSONのみを出力。前後に説明文やコードフェンスを付けない
- 専門用語は辞書通りの表記に統一
- block_id は "section-1", "section-2" のように連番`;
}

function getPreferredLlm(value: string | null | undefined) {
  if (value === "gpt-4o") {
    return "gpt-4o" as const;
  }
  return "claude-sonnet-4-6" as const;
}

export async function transcribeMeeting(meetingId: string) {
  const admin = createAdminClient();
  const openai = getOpenAiClient();

  const { data: meeting } = await admin
    .from("meetings")
    .select("id, organization_id, audio_url")
    .eq("id", meetingId)
    .maybeSingle<MeetingTranscriptionRow>();

  if (!meeting) {
    throw new Error("Meeting not found.");
  }

  if (!meeting.audio_url) {
    throw new Error("Audio file is not uploaded yet.");
  }

  await admin.from("meetings").update({ status: "transcribing" }).eq("id", meetingId);

  try {
    const { data: terms } = await admin
      .from("glossary_terms")
      .select("term, reading, pronunciation_variants")
      .eq("organization_id", meeting.organization_id)
      .order("occurrence_count", { ascending: false })
      .limit(80);

    const whisperPrompt = normalizeWhisperPromptTerms((terms ?? []) as GlossaryPromptTermRow[]);

    const { data: audioBlob, error: downloadError } = await admin.storage
      .from("audio")
      .download(meeting.audio_url);

    if (downloadError || !audioBlob) {
      throw new Error(`Audio download failed: ${downloadError?.message ?? "unknown error"}`);
    }

    const extension = getExtensionFromAudioPath(meeting.audio_url);
    let rawTranscript = "";
    let transcriptionDurationSeconds = 0;

    if (audioBlob.size <= WHISPER_SAFE_FILE_BYTES) {
      const singleResult = await transcribeWithWhisper({
        openai,
        fileBuffer: Buffer.from(await audioBlob.arrayBuffer()),
        filename: `meeting-audio${extension}`,
        mimeType: audioBlob.type || "audio/mpeg",
        prompt: whisperPrompt,
      });

      rawTranscript = singleResult.text;
      transcriptionDurationSeconds = singleResult.durationSeconds;
    } else {
      const segmentedAudioFiles = await segmentAudioForWhisper(audioBlob, extension);
      const chunkTexts: string[] = [];

      for (let index = 0; index < segmentedAudioFiles.length; index += 1) {
        const chunk = segmentedAudioFiles[index];

        if (chunk.buffer.byteLength > WHISPER_SAFE_FILE_BYTES) {
          throw new Error(
            `分割後の音声チャンクが大きすぎます（${formatMiB(chunk.buffer.byteLength)}MB）。` +
              " 元音声をさらに圧縮して再実行してください。",
          );
        }

        const chunkResult = await transcribeWithWhisper({
          openai,
          fileBuffer: chunk.buffer,
          filename: chunk.filename,
          mimeType: chunk.mimeType,
          prompt: whisperPrompt,
        });

        if (chunkResult.text) {
          chunkTexts.push(chunkResult.text);
        }
        transcriptionDurationSeconds += chunkResult.durationSeconds;
      }

      rawTranscript = chunkTexts.join("\n").trim();
    }

    if (!rawTranscript) {
      throw new Error("文字起こし結果が空でした。別形式の音声で再実行してください。");
    }

    const { data: correctionRows } = await admin
      .from("transcription_corrections")
      .select("wrong_text, correct_text, context_keywords")
      .eq("organization_id", meeting.organization_id)
      .eq("apply_globally", true);

    const correctedTranscript = applyCorrections(
      rawTranscript,
      (correctionRows ?? []) as CorrectionRow[],
    );

    await admin
      .from("meetings")
      .update({
        raw_transcript: rawTranscript,
        corrected_transcript: correctedTranscript,
        duration_seconds: Math.round(transcriptionDurationSeconds),
        status: "generating",
      })
      .eq("id", meetingId);

    const minutes = await generateMinutesForMeeting(meetingId, { adminClient: admin });

    return {
      meetingId,
      rawTranscript,
      correctedTranscript,
      minutes,
    };
  } catch (error) {
    await admin.from("meetings").update({ status: "failed" }).eq("id", meetingId);
    throw error;
  }
}

export async function generateMinutesForMeeting(
  meetingId: string,
  options?: GenerateMinutesOptions,
) {
  const admin = options?.adminClient ?? createAdminClient();

  const { data: meeting } = await admin
    .from("meetings")
    .select("id, organization_id, corrected_transcript, llm_used")
    .eq("id", meetingId)
    .maybeSingle<MeetingGenerationRow>();

  if (!meeting) {
    throw new Error("Meeting not found.");
  }

  if (!meeting.corrected_transcript || meeting.corrected_transcript.trim().length === 0) {
    throw new Error("No corrected transcript to generate minutes from.");
  }

  const { data: organization } = await admin
    .from("organizations")
    .select("default_llm")
    .eq("id", meeting.organization_id)
    .maybeSingle<OrganizationLlmRow>();

  const { data: glossaryTerms } = await admin
    .from("glossary_terms")
    .select("id, term, definition, detailed_explanation, full_form, aliases")
    .eq("organization_id", meeting.organization_id);

  const glossaryText = ((glossaryTerms ?? []) as GlossaryGenerationTermRow[])
    .map((term) => {
      const aliasString = term.aliases?.length ? `（別名: ${term.aliases.join(", ")}）` : "";
      const fullForm = term.full_form ? `[${term.full_form}]` : "";
      return `- ${term.term}${fullForm}${aliasString}: ${term.definition ?? ""}`;
    })
    .join("\n");

  const llm = getPreferredLlm(meeting.llm_used ?? organization?.default_llm);
  const systemPrompt = buildSystemPrompt(glossaryText);
  const userPrompt = `【文字起こし】\n${meeting.corrected_transcript}`;

  let rawResultJson = "";

  if (llm === "claude-sonnet-4-6") {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const textBlock = response.content.find((content) => content.type === "text");
    rawResultJson = textBlock?.type === "text" ? textBlock.text : "";
  } else {
    const openai = getOpenAiClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    rawResultJson = completion.choices[0]?.message?.content ?? "";
  }

  const jsonText = getJsonObjectText(rawResultJson);
  const parsed = normalizeGeneratedMinutesPayload(JSON.parse(jsonText));
  const minutesMarkdown = renderMinutesMarkdown(parsed);

  await admin
    .from("meetings")
    .update({
      minutes_markdown: minutesMarkdown,
      decisions: parsed.decisions,
      todos: parsed.todos,
      open_questions: parsed.open_questions,
      detected_terms: parsed.detected_terms,
      new_term_candidates: parsed.new_term_candidates,
      llm_used: llm,
      status: "completed",
    })
    .eq("id", meetingId);

  const uniqueDetectedTerms = Array.from(new Set(parsed.detected_terms.map((term) => term.term)));
  for (const term of uniqueDetectedTerms) {
    await admin.rpc("increment_term_occurrence", {
      p_organization_id: meeting.organization_id,
      p_term: term,
    });
  }

  return parsed;
}
