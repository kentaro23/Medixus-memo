export default function AuthLoading() {
  return (
    <section className="rounded-xl border bg-background p-6 shadow-sm">
      <div className="space-y-3">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-10 w-full animate-pulse rounded border bg-muted/40" />
        <div className="h-10 w-full animate-pulse rounded border bg-muted/40" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
      </div>
    </section>
  );
}
