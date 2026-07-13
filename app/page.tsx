"use client";

import Uploader from "@/components/Uploader";
import DatasetList from "@/components/DatasetList";

export default function HomePage() {
  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo">📊</div>
          <div>
            <h1>企微托管运营 · 数据仪表</h1>
            <p>导入数据 → LLM 自动分析 → 生成可视化看板</p>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gap: 24 }}>
        <Uploader />
        <div>
          <p className="section-title">已有数据集</p>
          <DatasetList />
        </div>
      </div>
    </div>
  );
}
