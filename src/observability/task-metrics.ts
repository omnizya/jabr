/**
 * observability/task-metrics.ts — Task lifecycle metrics and cost attribution.
 *
 * Counters:
 *   - jabr.tasks.created    (unit: tasks)
 *   - jabr.tasks.completed  (unit: tasks)
 *   - jabr.tasks.failed     (unit: tasks)
 *
 * Histograms:
 *   - jabr.task.duration_ms (unit: ms)
 *
 * Gauges:
 *   - jabr.tasks.inflight   (unit: tasks)
 *
 * Cost attribution:
 *   - jabr.cost.tokens (total budget consumed per agent per task)
 */

import { getMeter } from "./tracer";

export interface CostAttribution {
	agentName: string;
	taskId: string;
	tokens: number;
	usdCost?: number;
	currency?: string;
}

export class TaskMetrics {
	private meter;

	// Counters
	private tasksCreated;
	private tasksCompleted;
	private tasksFailed;

	// Histograms
	private taskDuration;
	private delegationLatency;

	// Gauges
	private inflightTasks;

	// Error rate tracking
	private errorByAgent = new Map<string, number>();
	private totalByAgent = new Map<string, number>();

	constructor() {
		this.meter = getMeter("jabr-task-metrics", "0.4.1");

		this.tasksCreated = this.meter.createCounter("jabr.tasks.created", {
			description: "Total tasks created",
			unit: "{task}",
		});
		this.tasksCompleted = this.meter.createCounter("jabr.tasks.completed", {
			description: "Total tasks completed successfully",
			unit: "{task}",
		});
		this.tasksFailed = this.meter.createCounter("jabr.tasks.failed", {
			description: "Total tasks failed",
			unit: "{task}",
		});
		this.taskDuration = this.meter.createHistogram("jabr.task.duration_ms", {
			description: "Task end-to-end duration",
			unit: "ms",
		});
		this.delegationLatency = this.meter.createHistogram(
			"jabr.delegation.latency_ms",
			{
				description: "Cross-agent delegation latency",
				unit: "ms",
			},
		);
		this.inflightTasks = this.meter.createGauge("jabr.tasks.inflight", {
			description: "Current number of in-flight tasks",
			unit: "{task}",
		});
	}

	/** Record a new task being created. */
	recordTaskCreated(agentName: string, taskId: string): void {
		this.tasksCreated.add(1, { agent: agentName, task_id: taskId });
		this.inflightTasks.set(this.getInflightCount() + 1, { agent: agentName });
	}

	/** Record a task completing successfully. */
	recordTaskCompleted(
		agentName: string,
		taskId: string,
		durationMs: number,
	): void {
		this.tasksCompleted.add(1, { agent: agentName, task_id: taskId });
		this.taskDuration.record(durationMs, { agent: agentName, status: "ok" });
		this.inflightTasks.set(Math.max(0, this.getInflightCount() - 1), {
			agent: agentName,
		});
		this.trackTotal(agentName);
	}

	/** Record a task failing. */
	recordTaskFailed(
		agentName: string,
		taskId: string,
		durationMs: number,
		errorMessage?: string,
	): void {
		this.tasksFailed.add(1, {
			agent: agentName,
			task_id: taskId,
			...(errorMessage ? { error: errorMessage.slice(0, 100) } : {}),
		});
		this.taskDuration.record(durationMs, { agent: agentName, status: "error" });
		this.inflightTasks.set(Math.max(0, this.getInflightCount() - 1), {
			agent: agentName,
		});
		this.trackError(agentName);
		this.trackTotal(agentName);
	}

	/** Record delegation latency between agents. */
	recordDelegationLatency(
		sourceAgent: string,
		targetAgent: string,
		latencyMs: number,
	): void {
		this.delegationLatency.record(latencyMs, {
			source: sourceAgent,
			target: targetAgent,
		});
	}

	/** Record cost attribution for a task. */
	recordCost(cost: CostAttribution): void {
		const costCounter = this.meter.createCounter(
			`jabr.cost.tokens.${cost.agentName}`,
			{
				description: `Total tokens consumed by ${cost.agentName}`,
				unit: "{token}",
			},
		);
		costCounter.add(cost.tokens, {
			agent: cost.agentName,
			task_id: cost.taskId,
			...(cost.currency ? { currency: cost.currency } : {}),
		});
	}

	/**
	 * Get the error rate for a specific agent (0-1).
	 */
	getErrorRate(agentName: string): number {
		const errors = this.errorByAgent.get(agentName) || 0;
		const total = this.totalByAgent.get(agentName) || 0;
		return total > 0 ? errors / total : 0;
	}

	private _inflightCount = 0;

	private getInflightCount(): number {
		return this._inflightCount;
	}

	private trackError(agentName: string): void {
		this.errorByAgent.set(
			agentName,
			(this.errorByAgent.get(agentName) || 0) + 1,
		);
	}

	private trackTotal(agentName: string): void {
		this.totalByAgent.set(
			agentName,
			(this.totalByAgent.get(agentName) || 0) + 1,
		);
	}
}
