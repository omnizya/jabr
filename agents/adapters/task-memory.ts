import type { Task, TaskStorePort } from "@ports/task-store";
import type { A2AMessage, A2APart } from "@agents/types";

export class TaskMemory implements TaskStorePort {
  private tasks = new Map<string, Task>();

  create(taskId: string): Task {
    const task: Task = {
      id: taskId,
      state: "working",
      messages: [],
      artifacts: [],
    };
    this.tasks.set(taskId, task);
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  updateState(taskId: string, state: Task["state"]): void {
    const task = this.tasks.get(taskId);
    if (task) task.state = state;
  }

  appendMessage(taskId: string, message: A2AMessage): void {
    const task = this.tasks.get(taskId);
    if (task) task.messages.push(message);
  }

  appendArtifact(taskId: string, artifact: { name: string; parts: A2APart[] }): void {
    const task = this.tasks.get(taskId);
    if (task) task.artifacts.push(artifact);
  }

  listByState(state: Task["state"]): Task[] {
    return [...this.tasks.values()].filter((t) => t.state === state);
  }
}
