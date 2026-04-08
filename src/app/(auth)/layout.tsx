import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-12">
      <div className="mx-auto mb-8 max-w-lg text-center">
        <Link href="/" className="text-2xl font-semibold tracking-tight">
          Medixus Minutes
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">
          研究室・医局向けのマルチテナント議事録 SaaS
        </p>
      </div>
      <div className="mx-auto max-w-lg">{children}</div>
    </main>
  );
}
