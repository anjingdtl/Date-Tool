import type { DatasetRow } from "@/lib/types";

export default function DataTable({
  rows,
  maxRows = 10,
}: {
  rows: DatasetRow[];
  maxRows?: number;
}) {
  if (!rows || rows.length === 0) {
    return <div className="empty">暂无数据</div>;
  }
  const cols = Object.keys(rows[0]);
  const shown = rows.slice(0, maxRows);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{formatCell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
