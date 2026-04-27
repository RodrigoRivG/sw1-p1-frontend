export type ActivityType = 'START' | 'END' | 'TASK' | 'DECISION' | 'FORK' | 'JOIN';

export interface Swimlane {
  id: string;
  name: string;
  role: string;
  order: number;
  color?: string;
}

export interface Activity {
  id: string;
  label: string;
  type: ActivityType;
  swimlaneId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface Transition {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

export interface WorkflowDefinition {
  policyId: number;
  swimlanes: Swimlane[];
  activities: Activity[];
  transitions: Transition[];
}
