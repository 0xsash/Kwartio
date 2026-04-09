import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Kwartio - Jouw boekhouding, automatisch",
  description: "Zero-touch bookkeeping voor Belgische zelfstandigen",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="min-h-full flex font-sans">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 pt-16 md:p-8 md:pt-8">{children}</main>
      </body>
    </html>
  );
}
