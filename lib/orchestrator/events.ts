/**
 * lib/orchestrator/events.ts
 *
 * 编排器事件类型与回调（SPEC 18.2 / 23）。
 * 兼容 v0.2 的 result/stage/token/final/done/error（由 analyzer 门面适配）。
 */
import type {
  AnalysisPlan,
  AnalysisReview,
  AnalysisRevision,
  AnalysisTask,
  FinalAnalysisResult,
  TaskExecutionResult,
} from "@/lib/types";

export type OrchestratorEvent =
  | "stage"
  | "understanding"
  | "ambiguity"
  | "plan"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "review"
  | "question"
  | "revision"
  | "token"
  | "final"
  | "done"
  | "error";

export interface OrchestratorHooks {
  onStage?: (code: string, message: string) => void;
  onPlan?: (plan: AnalysisPlan) => void;
  onTaskStarted?: (task: AnalysisTask) => void;
  onTaskCompleted?: (task: AnalysisTask, result: TaskExecutionResult) => void;
  onTaskFailed?: (task: AnalysisTask, result: TaskExecutionResult) => void;
  onReview?: (review: AnalysisReview) => void;
  onQuestion?: (questions: string[]) => void;
  onRevision?: (revision: AnalysisRevision) => void;
  onNarrativeToken?: (token: string) => void;
  onFinal?: (finalResult: FinalAnalysisResult) => void;
}
