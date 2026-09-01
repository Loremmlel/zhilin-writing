import type { Metadata } from "next";
import { RouteProgress } from "@/components/loading/route-progress";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "知临中学",
    template: "%s · 知临中学",
  },
  description: "一个安静、私密的 Markdown 写作与阅读社区。",
  openGraph: {
    title: "知临中学",
    description: "私人 Markdown 写作社区",
    type: "website",
    images: [{ url: "/og.png", width: 1732, height: 910, alt: "知临中学 · 私人 Markdown 写作社区" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "知临中学",
    description: "私人 Markdown 写作社区",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <RouteProgress />
        {children}
      </body>
    </html>
  );
}
