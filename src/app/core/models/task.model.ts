export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskReport {
  observation: string;
}

export interface Task {
  id: string;
  procedureId: string;
  userId: string;
  nodeId: string;
  nodeLabel?: string;
  clientName?: string;
  report: TaskReport | null;
  status: TaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface TaskCompleteRequest {
  report: TaskReport;
}
