import type { AgentCard, AgentSkill, TaskState } from "@agents/types";
import { jabrUrlForPort } from "@config/jabr-config";
import {
	PROTOCOL_BINDING_HTTP,
	PROTOCOL_BINDING_JSONRPC,
	SUPPORTED_INTERFACES_VERSION,
} from "@constants/a2a-v1";
import { JABR_PORTS } from "@constants/ecosystem";
import type { LlmPort } from "@ports/llm-port";

export interface LlmAgentConfig {
	name: string;
	description: string;
	version: string;
	port: number;
	skills?: AgentSkill[];
}

export class LlmAgent {
	public readonly card: AgentCard;
	private readonly llm: LlmPort;

	constructor(config: LlmAgentConfig, llm: LlmPort) {
		this.llm = llm;
		const baseUrl = jabrUrlForPort(config.port);
		this.card = {
			name: config.name,
			description: config.description,
			url: baseUrl,
			version: config.version,
			capabilities: {
				streaming: true,
				pushNotifications: false,
				stateTransitionHistory: false,
			},
			securitySchemes: {},
			securityRequirements: [],
			supportedInterfaces: [
				{
					url: baseUrl,
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
				{
					url: baseUrl,
					protocolBinding: PROTOCOL_BINDING_HTTP,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: config.skills ?? [
				{
					name: "General LLM",
					description: "General-purpose language model interaction",
					tags: ["llm", "chat", "generation"],
				},
			],
		};
	}

	async handleTask(message: string): Promise<string> {
		const request = { prompt: message };
		const response = await this.llm.generate(request);
		return response.text;
	}

	async handleTaskStreaming(
		message: string,
		taskId: string,
		emit: (event: {
			type: "status" | "artifact";
			taskId: string;
			state?: TaskState;
			message?: string;
			timestamp: string;
			artifact?: {
				name: string;
				parts: Array<{ kind: string; text?: string }>;
			};
		}) => void,
	): Promise<string> {
		let fullText = "";

		const onChunk = (chunk: string) => {
			fullText += chunk;
			emit({
				type: "artifact",
				taskId,
				artifact: {
					name: "streaming-response",
					parts: [{ kind: "text", text: chunk }],
				},
				timestamp: new Date().toISOString(),
			});
		};

		const request = { prompt: message };
		const response = await this.llm.streamGenerate(request, onChunk);

		// Emit final completion status
		emit({
			type: "status",
			taskId,
			state: "completed",
			message: response.text.slice(0, 200),
			timestamp: new Date().toISOString(),
		});

		return response.text;
	}
}
