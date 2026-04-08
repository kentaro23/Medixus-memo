import Link from "next/link";

type GlossaryTermData = {
  id: string;
  term: string;
  definition: string | null;
  detailed_explanation: string | null;
  full_form: string | null;
  pronunciation_variants: string[] | null;
};

export function GlossaryTerm({
  term,
  data,
  orgSlug,
}: {
  term: string;
  data?: GlossaryTermData;
  orgSlug: string;
}) {
  if (!data) {
    return <span className="underline decoration-dotted underline-offset-2">{term}</span>;
  }

  const tooltip = (
    <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-80 rounded-md border bg-background p-3 text-left text-xs shadow-lg group-hover:block">
      <span className="block text-sm font-semibold">{data.term}</span>
      {data.full_form ? (
        <span className="mt-1 block text-muted-foreground">{data.full_form}</span>
      ) : null}
      {data.definition ? (
        <span className="mt-2 block text-foreground">{data.definition}</span>
      ) : null}
      {data.detailed_explanation ? (
        <span className="mt-2 block border-t pt-2 text-muted-foreground">
          {data.detailed_explanation}
        </span>
      ) : null}
      {(data.pronunciation_variants ?? []).length > 0 ? (
        <span className="mt-2 block text-muted-foreground">
          発音: {(data.pronunciation_variants ?? []).join("・")}
        </span>
      ) : null}
    </span>
  );

  return (
    <span className="group relative inline-block align-baseline">
      <Link
        href={`/orgs/${orgSlug}/glossary/${data.id}`}
        className="cursor-help underline decoration-dotted decoration-blue-400 underline-offset-2 text-blue-700 hover:text-blue-800"
      >
        {term}
      </Link>
      {tooltip}
    </span>
  );
}
