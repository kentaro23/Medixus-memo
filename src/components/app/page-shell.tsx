import Link from "next/link";

export function PageShell({
  title,
  description,
  orgSlug,
  children,
}: {
  title: string;
  description: string;
  orgSlug?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-background p-6 shadow-sm">
      {orgSlug ? (
        <div className="text-xs text-muted-foreground">
          <Link href={`/orgs/${orgSlug}`} className="underline">
            {orgSlug}
          </Link>
        </div>
      ) : null}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
