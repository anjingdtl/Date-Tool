import type { Metadata } from "next";
import AutoShutdown from "@/components/AutoShutdown";
import "./globals.css";

export const metadata: Metadata = {
  title: "企微托管运营 · 可视化数据仪表",
  description: "导入数据 → LLM 自动分析 → 生成可视化看板",
};

/**
 * 页面首次渲染前读取 localStorage 的主题，避免主题切换时的"白闪 FOUC"。
 * 在 <head> 里 inline 一段最小脚本，浏览器解析到即同步执行。
 */
const themeBootstrap = `(function(){try{var t=localStorage.getItem('theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        {/* 浏览器关闭后自动通知服务端退出 + 定时心跳保活 */}
        <AutoShutdown />
      </body>
    </html>
  );
}