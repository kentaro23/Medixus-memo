import Anthropic from "@anthropic-ai/sdk";

function parseJsonKeywords(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  if (!cleaned) {
    return [];
  }

  try {
    const parsed = JSON.parse(cleaned) as { keywords?: unknown };
    if (Array.isArray(parsed.keywords)) {
      return parsed.keywords
        .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
        .filter((keyword) => keyword.length > 0)
        .slice(0, 5);
    }
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(candidate) as { keywords?: unknown };
        if (Array.isArray(parsed.keywords)) {
          return parsed.keywords
            .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
            .filter((keyword) => keyword.length > 0)
            .slice(0, 5);
        }
      } catch {
        return [];
      }
    }
  }

  return [];
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function extractHeuristicKeywords({
  context,
  wrongText,
  correctText,
}: {
  context: string;
  wrongText: string;
  correctText: string;
}) {
  const tokens = context
    .replaceAll(wrongText, " ")
    .replaceAll(correctText, " ")
    .match(/[A-Za-z0-9一-龠ぁ-んァ-ヶー]{2,}/g);

  if (!tokens) {
    return [];
  }

  return dedupe(tokens).slice(0, 5);
}

export async function extractContextKeywords({
  context,
  wrongText,
  correctText,
}: {
  context: string;
  wrongText: string;
  correctText: string;
}) {
  const trimmedContext = context.trim();
  if (trimmedContext.length < 10) {
    return [];
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return extractHeuristicKeywords({ context: trimmedContext, wrongText, correctText });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: `以下の文章から、専門用語「${correctText}」が出現する文脈を特徴づけるキーワードを最大5つ抽出してください。
文章内の「${wrongText}」が後で「${correctText}」を意味するか判定する目的です。

文章: "${trimmedContext}"

JSON形式で返してください:
{"keywords":["キーワード1","キーワード2"]}`,
        },
      ],
    });

    const textBlock = response.content.find((content) => content.type === "text");
    const text = textBlock?.type === "text" ? textBlock.text : "";
    const keywords = parseJsonKeywords(text);

    if (keywords.length > 0) {
      return keywords;
    }
  } catch {
    // fall through to heuristic extraction
  }

  return extractHeuristicKeywords({ context: trimmedContext, wrongText, correctText });
}
