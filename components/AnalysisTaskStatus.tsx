export interface TaskStatusItem {
  id: string;
  title: string;
  status: "running" | "success" | "failed";
  message?: string;
}

export default function AnalysisTaskStatus({ tasks }: { tasks: TaskStatusItem[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card agent-panel">
      <h3>任务执行</h3>
      <div className="agent-task-list">
        {tasks.map((task) => (
          <div className="row spread" key={task.id}>
            <span>
              {task.title || task.id}
              {task.message && (
                <span className="muted" style={{ display: "block", fontSize: 12 }}>
                  {task.message}
                </span>
              )}
            </span>
            <span className={`badge ${task.status === "running" ? "muted" : ""}`}>
              {task.status === "running" ? "执行中" : task.status === "success" ? "已完成" : "失败"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
