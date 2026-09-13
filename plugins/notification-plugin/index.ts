import type { IPlugin, PluginContext, PluginMetadata } from "@ports/plugin";
import type {
	SystemAlertPayload,
	TaskFailedPayload,
} from "@ports/plugin-event-bus.types";

let ctx: PluginContext | undefined;

const metadata: PluginMetadata = {
	name: "notification-plugin",
	version: "1.0.0",
	author: "Jabr Team",
	description: "Sends notifications on task failures and system alerts",
	events: ["onTaskFailed", "onSystemAlert"],
	capabilities: [],
	tags: {
		category: "notifications",
		purpose: "alerting",
	},
};

const plugin: IPlugin = {
	metadata,
	async onInitialize(initCtx) {
		ctx = initCtx;
		ctx.logger.info(
			"Notification plugin initialized - watching for failures and alerts",
		);
	},
	async onEvent(event, payload) {
		if (event.name === "onTaskFailed") {
			const taskPayload = payload as TaskFailedPayload;
			ctx?.logger.warn(
				`[NOTIFICATION] Task failed: ${taskPayload.taskId} (${taskPayload.title}) - ${taskPayload.error?.message}`,
			);
		} else if (event.name === "onSystemAlert") {
			const alertPayload = payload as SystemAlertPayload;
			ctx?.logger.warn(
				`[NOTIFICATION] System alert: ${alertPayload.severity.toUpperCase()} - ${alertPayload.title}: ${alertPayload.message}`,
			);
		}
	},
	async onShutdown() {
		// No cleanup needed
	},
};

export default plugin;
export function createPlugin() {
	return plugin;
}
