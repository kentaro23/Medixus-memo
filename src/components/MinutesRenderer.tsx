import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

import { GlossaryTerm } from "@/components/GlossaryTerm";

type GlossaryTermLookupRow = {
  id: string;
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  pronunciation_variants: string[] | null;
};

function escapeAttributeValue(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceGlossarySyntax(markdown: string) {
  return markdown.replace(/\{\{term:([^}]+)\}\}/g, (_, rawTerm) => {
    const term = String(rawTerm).trim();
    return `<glossary-term data-term="${escapeAttributeValue(term)}"></glossary-term>`;
  });
}

export function MinutesRenderer({
  markdown,
  glossaryTerms,
  orgSlug,
}: {
  markdown: string;
  glossaryTerms: GlossaryTermLookupRow[];
  orgSlug: string;
}) {
  const termMap = new Map(glossaryTerms.map((term) => [term.term, term]));
  const processedMarkdown = replaceGlossarySyntax(markdown);
  const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="mt-6 text-xl font-semibold">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="mt-4 text-lg font-semibold">{children}</h3>
    ),
    p: ({ children }: { children?: React.ReactNode }) => <p className="leading-7">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc space-y-1 pl-6">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal space-y-1 pl-6">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    "glossary-term": (props: Record<string, unknown>) => {
      const termValue = props["data-term"];
      const term = typeof termValue === "string" ? termValue : "";
      const termData = termMap.get(term);
      return <GlossaryTerm term={term} data={termData} orgSlug={orgSlug} />;
    },
  };

  return (
    <div className="space-y-4 rounded-lg border bg-background p-4">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        components={markdownComponents as never}
      >
        {processedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
