import type { A2AMessage, A2APart } from "../types.ts";

/** Simplified task representation used by core modules.
 * FIXME: Task state should be shared types for maintainance
 */
export interface Task {
  id: string;
  state: "working" | "completed" | "failed" | "canceled";
  messages: A2AMessage[];
  artifacts: Array<{ name: string; parts: A2APart[] }>;
}

/**
 * Outbound port: persist and retrieve task state.
 * Adapter: in-memory Map (can swap to DB later).
 */
export interface TaskStorePort {
  create(taskId: string): Task;
  get(taskId: string): Task | undefined;
  updateState(taskId: string, state: Task["state"]): void;
  appendMessage(taskId: string, message: A2AMessage): void;
  appendArtifact(
    taskId: string,
    artifact: { name: string; parts: A2APart[] },
  ): void;
}
