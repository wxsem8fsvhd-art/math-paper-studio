import "./site-shell.css";

export const metadata = {
  title: "组题工坊 · 数学练习排版",
  description: "从多份数学试卷 PDF 中框选题目，统一排版并导出新的 A4 练习 PDF。",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
