import type { IPlugin, PluginContext, PluginMetadata } from "@ports/plugin";

let ctx: PluginContext | undefined;

const metadata: PluginMetadata = {
	name: "analytics-plugin",
	version: "1.0.0",
	author: "Jabr Team",
	description: "Logs all domain events for analytics purposes",
	events: [
		"onAgentStart",
		"onAgentComplete",
		"onAgentError",
		"onTaskStart",
		"onTaskComplete",
		"onTaskFailed",
		"onSystemAlert",
	],
	capabilities: [],
	tags: {
		category: "analytics",
		purpose: "event-logging",
	},
};

const plugin: IPlugin = {
	metadata,
	async onInitialize(initCtx) {
		ctx = initCtx;
		ctx.logger.info(
			"Analytics plugin initialized - listening to all domain events",
		);
	},
	async onEvent(event, payload) {
		ctx?.logger.info(
			`[ANALYTICS] Event: ${event.name} ${JSON.stringify(payload)}`,
		);
	},
	async onShutdown() {
		// No cleanup needed for this simple plugin
	},
};

export default plugin;
export function createPlugin() {
	return plugin;
}
