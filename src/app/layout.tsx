import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "共筑 · 共同资金账本",
  description: "为两人共同目标设计的可审批资金记录工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
