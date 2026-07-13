import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import { buildChartOption } from "@/lib/chart";
import type { ChartSpec, DatasetRow, EChartsOption } from "@/lib/types";
import DataTable from "./DataTable";

export default function ChartCard({
  spec,
  rows = [],
  option,
}: {
  spec: ChartSpec;
  rows?: DatasetRow[];
  option?: EChartsOption;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spec.type === "table") return;
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const opt = option ?? buildChartOption(spec, rows);
    chart.setOption(opt as unknown as echarts.EChartsCoreOption);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [spec, rows, option]);

  if (spec.type === "table") {
    return (
      <div className="chart-card">
        <p className="chart-title">{spec.title}</p>
        {spec.description && <p className="chart-desc">{spec.description}</p>}
        <DataTable rows={rows} />
      </div>
    );
  }

  return (
    <div className="chart-card">
      <p className="chart-title">{spec.title}</p>
      {spec.description && <p className="chart-desc">{spec.description}</p>}
      <div className="chart-box" ref={ref} />
    </div>
  );
}
