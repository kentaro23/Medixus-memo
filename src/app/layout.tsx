import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Medixus Minutes",
  description: "Research team minute-taking SaaS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
