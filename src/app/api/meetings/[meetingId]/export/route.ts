import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type Params = {
  meetingId: string;
};

type MeetingRow = {
  id: string;
  organization_id: string;
  title: string;
  minutes_markdown: string | null;
  created_at: string;
};

type GlossaryRow = {
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
};

function sanitizeFileName(input: string) {
  const normalized = input.trim().replace(/[\\/:*?"<>|]/g, "-");
  return normalized.length > 0 ? normalized : "meeting-minutes";
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractTermOrder(markdown: string) {
  const termOrder: string[] = [];
  const seen = new Set<string>();
  const regex = /\{\{term:([^}]+)\}\}/g;

  let match = regex.exec(markdown);
  while (match) {
    const term = match[1].trim();
    if (term && !seen.has(term)) {
      seen.add(term);
      termOrder.push(term);
    }
    match = regex.exec(markdown);
  }

  return termOrder;
}

function buildGlossaryFootnoteText(glossary: GlossaryRow | undefined) {
  if (!glossary) {
    return "辞書情報なし";
  }

  const segments = [glossary.full_form, glossary.definition, glossary.detailed_explanation]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return segments.length > 0 ? segments.join(" / ") : "辞書情報なし";
}

function buildMarkdownWithGlossaryFootnotes(markdown: string, glossaryRows: GlossaryRow[]) {
  const termOrder = extractTermOrder(markdown);
  if (termOrder.length === 0) {
    return markdown;
  }

  const glossaryByTerm = new Map(glossaryRows.map((row) => [row.term, row]));
  const indexByTerm = new Map<string, number>();

  termOrder.forEach((term, index) => {
    indexByTerm.set(term, index + 1);
  });

  const replaced = markdown.replace(/\{\{term:([^}]+)\}\}/g, (_, rawTerm: string) => {
    const term = rawTerm.trim();
    const footnoteIndex = indexByTerm.get(term);
    if (!footnoteIndex) {
      return term;
    }
    return `${term}[^g${footnoteIndex}]`;
  });

  const footnotes = termOrder.map((term) => {
    const index = indexByTerm.get(term)!;
    const definition = buildGlossaryFootnoteText(glossaryByTerm.get(term));
    return `[^g${index}]: ${term} - ${definition}`;
  });

  return `${replaced}

## 用語脚注
${footnotes.join("\n")}`;
}

function buildPrintableHtml({
  title,
  createdAt,
  markdown,
}: {
  title: string;
  createdAt: string;
  markdown: string;
}) {
  const escapedTitle = escapeHtml(title);
  const escapedDate = escapeHtml(createdAt);
  const escapedMarkdown = escapeHtml(markdown);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle} - Medixus Minutes Export</title>
    <style>
      body {
        font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
        margin: 24px;
        line-height: 1.6;
        color: #111827;
      }
      h1 {
        margin: 0 0 4px 0;
        font-size: 24px;
      }
      .meta {
        color: #6b7280;
        font-size: 12px;
        margin-bottom: 16px;
      }
      .actions {
        margin-bottom: 16px;
      }
      .actions button {
        background: #111827;
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 16px;
        background: #fafafa;
      }
      @media print {
        .actions {
          display: none;
        }
        body {
          margin: 0;
        }
        pre {
          border: none;
          padding: 0;
          background: #fff;
        }
      }
    </style>
  </head>
  <body>
    <h1>${escapedTitle}</h1>
    <div class="meta">Exported at ${escapedDate}</div>
    <div class="actions">
      <button onclick="window.print()">印刷 / PDF保存</button>
    </div>
    <pre>${escapedMarkdown}</pre>
  </body>
</html>`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { meetingId } = await Promise.resolve(params);
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "markdown";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, organization_id, title, minutes_markdown, created_at")
    .eq("id", meetingId)
    .maybeSingle<MeetingRow>();

  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", meeting.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const markdown = meeting.minutes_markdown?.trim() ?? "";
  if (!markdown) {
    return NextResponse.json({ error: "Minutes are not generated yet." }, { status: 400 });
  }

  const usedTerms = extractTermOrder(markdown);
  const glossaryRows: GlossaryRow[] =
    usedTerms.length > 0
      ? (
          await supabase
            .from("glossary_terms")
            .select("term, definition, detailed_explanation, full_form")
            .eq("organization_id", meeting.organization_id)
            .in("term", usedTerms)
        ).data ?? []
      : [];

  const markdownWithFootnotes = buildMarkdownWithGlossaryFootnotes(markdown, glossaryRows);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filenameBase = sanitizeFileName(`${meeting.title}-${timestamp}`);

  if (format === "pdf") {
    const html = buildPrintableHtml({
      title: meeting.title,
      createdAt: new Date().toLocaleString("ja-JP"),
      markdown: markdownWithFootnotes,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(markdownWithFootnotes, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
