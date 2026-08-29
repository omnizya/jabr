import type { A2AMessage, A2APart } from "@agents/types";

export interface Task {
  id: string;
  state: "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled" | "rejected" | "auth-required" | "unknown";
  messages: A2AMessage[];
  artifacts: Array<{ name: string; parts: A2APart[] }>;
}

export interface TaskStorePort {
  create(taskId: string): Task;
  get(taskId: string): Task | undefined;
  updateState(taskId: string, state: Task["state"]): void;
  appendMessage(taskId: string, message: A2AMessage): void;
  appendArtifact(
    taskId: string,
    artifact: { name: string; parts: A2APart[] },
  ): void;
  listByState(state: Task["state"]): Task[];
  getTransitionHistory(taskId: string): Array<{ from: Task["state"]; to: Task["state"]; timestamp: string }>;
}

console.log("[TaskStorePort] port interface loaded");
