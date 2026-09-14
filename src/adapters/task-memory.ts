import type { A2AMessage, A2APart } from "@agents/types";
import type {
	DLQEntry,
	Task,
	TaskFilter,
	TaskStorePort,
} from "@ports/task-store";
import type { Task as A2ATask } from "../types/a2a-v1.ts";

export class TaskMemory implements TaskStorePort {
	private tasks = new Map<string, Task>();
	private transitions = new Map<
		string,
		Array<{ from: Task["state"]; to: Task["state"]; timestamp: string }>
	>();
	private dlq = new Map<string, DLQEntry>();
	private subscriptions = new Map<string, Set<(task: Task) => void>>();

	create(taskId: string): Task {
		const task: Task = {
			id: taskId,
			state: "submitted",
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
		if (task) {
			const from = task.state;
			if (from !== state) {
				const now = new Date().toISOString();
				this.transitions.get(taskId)?.push({ from, to: state, timestamp: now });
			}
			task.state = state;
			this.notifySubscribers(taskId, task);
		} else
			console.error(`[TaskMemory] updateState failed: unknown task ${taskId}`);
	}

	appendMessage(taskId: string, message: A2AMessage): void {
		const task = this.tasks.get(taskId);
		if (task) {
			task.messages.push(message);
			this.notifySubscribers(taskId, task);
		}
	}

	appendArtifact(
		taskId: string,
		artifact: { name: string; parts: A2APart[] },
	): void {
		const task = this.tasks.get(taskId);
		if (task) {
			task.artifacts.push(artifact);
			this.notifySubscribers(taskId, task);
		}
	}

	listByState(state: Task["state"]): Task[] {
		return [...this.tasks.values()].filter((t) => t.state === state);
	}

	list(filter?: TaskFilter): Task[] {
		let tasks = [...this.tasks.values()];

		if (filter?.status) {
			tasks = tasks.filter((t) => t.state === filter.status);
		}
		if (filter?.contextId) {
			// Filter by contextId in messages
			tasks = tasks.filter((t) =>
				t.messages.some((m) => m.contextId === filter.contextId),
			);
		}
		if (filter?.pageSize) {
			tasks = tasks.slice(0, filter.pageSize);
		}

		return tasks;
	}

	subscribe(taskId: string, cb: (task: Task) => void): () => void {
		if (!this.subscriptions.has(taskId)) {
			this.subscriptions.set(taskId, new Set());
		}
		this.subscriptions.get(taskId)!.add(cb);

		// Immediately emit current task state
		const task = this.tasks.get(taskId);
		if (task) {
			cb(task);
		}

		// Return unsubscribe function
		return () => {
			const subs = this.subscriptions.get(taskId);
			if (subs) {
				subs.delete(cb);
				if (subs.size === 0) {
					this.subscriptions.delete(taskId);
				}
			}
		};
	}

	private notifySubscribers(taskId: string, task: Task): void {
		const subs = this.subscriptions.get(taskId);
		if (subs) {
			for (const cb of subs) {
				try {
					cb(task);
				} catch (e) {
					console.error(`[TaskMemory] subscriber callback error: ${e}`);
				}
			}
		}
	}

	getTransitionHistory(
		taskId: string,
	): Array<{ from: Task["state"]; to: Task["state"]; timestamp: string }> {
		return this.transitions.get(taskId) ?? [];
	}

	// ---- Dead Letter Queue (DLQ) ----

	getRetryCount(taskId: string): number {
		const task = this.tasks.get(taskId);
		return task ? ((task as any).retryCount ?? 0) : 0;
	}

	incrementRetryCount(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (task) {
			(task as any).retryCount = ((task as any).retryCount ?? 0) + 1;
		}
	}

	moveToDLQ(taskId: string, error: string): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		const retryCount = this.getRetryCount(taskId);
		const entry: DLQEntry = {
			taskId,
			state: task.state,
			error,
			retryCount,
			movedAt: new Date().toISOString(),
			messageCount: task.messages.length,
		};
		this.dlq.set(taskId, entry);
	}

	listDLQ(): DLQEntry[] {
		return [...this.dlq.values()].sort((a, b) =>
			b.movedAt.localeCompare(a.movedAt),
		);
	}

	getDLQEntry(taskId: string): DLQEntry | undefined {
		return this.dlq.get(taskId);
	}

	retryFromDLQ(taskId: string): boolean {
		if (!this.dlq.has(taskId)) return false;
		this.dlq.delete(taskId);
		const task = this.tasks.get(taskId);
		if (task) {
			task.state = "submitted";
			this.notifySubscribers(taskId, task);
		}
		return true;
	}

	purgeDLQ(taskId: string): boolean {
		return this.dlq.delete(taskId);
	}

	purgeAllDLQ(): number {
		const count = this.dlq.size;
		this.dlq.clear();
		return count;
	}
}
