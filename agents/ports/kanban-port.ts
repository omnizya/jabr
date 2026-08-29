export type KanbanTaskStatus =
  | "archived"
  | "blocked"
  | "done"
  | "ready"
  | "review"
  | "running"
  | "scheduled"
  | "todo"
  | "triage";

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanTaskStatus;
  priority: number;
  result: string | null;
  created_at: number;
  updated_at?: number;
}

export interface CreateTaskOpts {
  body?: string;
  assignee?: string;
  priority?: number;
  parent?: string;
  project?: string;
  workspace?: string;
  skill?: string[];
  maxRuntime?: string;
  model?: string;
  provider?: string;
}

export interface KanbanPort {
  createTask(title: string, opts?: CreateTaskOpts): Promise<KanbanTask>;
  listTasks(status?: KanbanTaskStatus): Promise<KanbanTask[]>;
  getTask(taskId: string): Promise<KanbanTask | null>;
  updateStatus(taskId: string, status: KanbanTaskStatus): Promise<void>;
  complete(taskId: string, result?: string): Promise<void>;
  comment(taskId: string, text: string): Promise<void>;
  block(taskId: string, reason: string): Promise<void>;
  unblock(taskId: string): Promise<void>;
}

console.log("[KanbanPort] port interface loaded");
