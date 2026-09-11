import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "proactive-coach",
  description: "一个主动找你的减肥陪伴 Agent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const content = (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return content;

  return (
    <ClerkProvider>
      {content}
    </ClerkProvider>
  );
}
