import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agent Eval - SRE Agent 评测系统",
  description: "SRE Agent 评测系统仪表盘 — 自愈成功率、MTTD、MTTR 实时监测",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-gray-950 text-gray-100 font-sans">
        {children}
      </body>
    </html>
  );
}
