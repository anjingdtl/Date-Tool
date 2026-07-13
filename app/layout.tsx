import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "企微托管运营 · 可视化数据仪表",
  description: "导入数据 → LLM 自动分析 → 生成可视化看板",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
