/**
 * A2A Protocol v1.0 Serialization Tests
 * Golden payload tests for strict camelCase emit and lenient parse.
 */

import { describe, expect, test } from "bun:test";
import {
	fromWireAgentCard,
	fromWireCancelTaskRequest,
	fromWireExtendedAgentCard,
	fromWireGetTaskRequest,
	fromWireListTasksRequest,
	fromWireListTasksResponse,
	fromWireMessage,
	fromWirePart,
	fromWireSendMessageRequest,
	fromWireSendMessageResponse,
	fromWireStreamResponse,
	fromWireTask,
	fromWireTaskArtifactUpdateEvent,
	fromWireTaskStatusUpdateEvent,
	parsePart,
	serializePart,
	toWireAgentCard,
	toWireCancelTaskRequest,
	toWireExtendedAgentCard,
	toWireGetTaskRequest,
	toWireListTasksRequest,
	toWireListTasksResponse,
	toWireMessage,
	toWirePart,
	toWireSendMessageRequest,
	toWireSendMessageResponse,
	toWireStreamResponse,
	toWireTask,
	toWireTaskArtifactUpdateEvent,
	toWireTaskStatusUpdateEvent,
} from "../../src/adapters/a2a/serialize.ts";
import type {
	AgentCard,
	Message,
	Part,
	Task,
	TaskState,
} from "../../src/types/a2a-v1.ts";

describe("Part serialization", () => {
	test("text part: emit camelCase, parse lenient", () => {
		const part: Part = { kind: "text", text: "hello" };
		const wire = toWirePart(part);
		expect(wire).toEqual({ text: "hello" });

		// Parse camelCase
		const parsed1 = fromWirePart({ text: "world" });
		expect(parsed1).toEqual({ kind: "text", text: "world" });

		// Parse legacy kind discriminator
		const parsed2 = fromWirePart({ kind: "text", text: "legacy" });
		expect(parsed2).toEqual({ kind: "text", text: "legacy" });
	});

	test("file part: emit camelCase with uri/filename/media_type", () => {
		const part: Part = {
			kind: "file",
			file: {
				name: "doc.pdf",
				mimeType: "application/pdf",
				uri: "https://example.com/doc.pdf",
			},
		};
		const wire = toWirePart(part);
		expect(wire).toEqual({
			url: "https://example.com/doc.pdf",
			filename: "doc.pdf",
			media_type: "application/pdf",
		});

		// Parse snake_case keys
		const parsed = fromWirePart({
			url: "https://example.com/doc.pdf",
			filename: "doc.pdf",
			media_type: "application/pdf",
		});
		expect(parsed.kind).toBe("file");
		if (parsed.kind !== "file") {
			throw new Error("expected file part");
		}
		expect(parsed.file.name).toBe("doc.pdf");
		expect(parsed.file.mimeType).toBe("application/pdf");
		expect(parsed.file.uri).toBe("https://example.com/doc.pdf");
	});

	test("file part with bytes: base64 string on wire", () => {
		const part: Part = {
			kind: "file",
			file: { name: "img.png", mimeType: "image/png", bytes: "aGVsbG8=" },
		};
		const wire = toWirePart(part);
		expect(wire).toEqual({
			url: "",
			filename: "img.png",
			media_type: "image/png",
			bytes: "aGVsbG8=",
		});
	});

	test("raw part: base64 bytes", () => {
		const part: Part = { kind: "raw", raw: "aGVsbG8=" };
		const wire = toWirePart(part);
		expect(wire).toEqual({ raw: "aGVsbG8=" });
	});

	test("data part: pass through JSON value", () => {
		const part: Part = { kind: "data", data: { foo: "bar", num: 42 } };
		const wire = toWirePart(part);
		expect(wire).toEqual({ data: { foo: "bar", num: 42 } });
	});

	test("functionCall part", () => {
		const part: Part = {
			kind: "functionCall",
			functionCall: {
				id: "call-1",
				name: "getWeather",
				args: { location: "NYC" },
			},
		};
		const wire = toWirePart(part);
		expect(wire).toEqual({
			functionCall: {
				id: "call-1",
				name: "getWeather",
				args: { location: "NYC" },
			},
		});
	});

	test("functionResponse part", () => {
		const part: Part = {
			kind: "functionResponse",
			functionResponse: {
				id: "call-1",
				name: "getWeather",
				response: { temp: 72 },
			},
		};
		const wire = toWirePart(part);
		expect(wire).toEqual({
			functionResponse: {
				id: "call-1",
				name: "getWeather",
				response: { temp: 72 },
			},
		});
	});
});

describe("Message serialization", () => {
	test("emit strict camelCase keys", () => {
		const msg: Message = {
			role: "user",
			messageId: "msg-123",
			contextId: "ctx-456",
			taskId: "task-789",
			parts: [{ kind: "text", text: "hello" }],
			referenceTaskIds: ["ref-1", "ref-2"],
			metadata: { custom: "value" },
		};
		const wire = toWireMessage(msg);
		expect(wire).toEqual({
			role: "user",
			messageId: "msg-123",
			contextId: "ctx-456",
			taskId: "task-789",
			parts: [{ text: "hello" }],
			referenceTaskIds: ["ref-1", "ref-2"],
			metadata: { custom: "value" },
		});
	});

	test("parse snake_case keys (message_id, context_id, task_id, reference_task_ids)", () => {
		const wire = {
			role: "agent",
			message_id: "msg-123",
			context_id: "ctx-456",
			task_id: "task-789",
			parts: [{ text: "hello" }],
			reference_task_ids: ["ref-1"],
			metadata: { custom: "value" },
		};
		const parsed = fromWireMessage(wire);
		expect(parsed.messageId).toBe("msg-123");
		expect(parsed.contextId).toBe("ctx-456");
		expect(parsed.taskId).toBe("task-789");
		expect(parsed.referenceTaskIds).toEqual(["ref-1"]);
	});

	test("parse legacy part discriminators inside message", () => {
		const wire = {
			role: "user",
			message_id: "msg-1",
			parts: [{ kind: "text", text: "legacy" }],
		};
		const parsed = fromWireMessage(wire);
		expect(parsed.parts[0]).toEqual({ kind: "text", text: "legacy" });
	});
});

describe("Task serialization", () => {
	const sampleTask: Task = {
		taskId: "task-123",
		contextId: "ctx-456",
		status: {
			state: "working",
			message: {
				role: "agent",
				messageId: "msg-1",
				parts: [{ kind: "text", text: "processing" }],
			},
			timestamp: "2026-09-11T10:00:00Z",
		},
		history: [
			{
				role: "user",
				messageId: "msg-0",
				parts: [{ kind: "text", text: "start" }],
			},
		],
		artifacts: [
			{
				artifactId: "art-1",
				name: "result",
				parts: [{ kind: "text", text: "done" }],
			},
		],
		metadata: { key: "value" },
	};

	test("emit strict camelCase: taskId, contextId, status.state, status.message, status.timestamp, history, artifacts, metadata", () => {
		const wire = toWireTask(sampleTask);
		expect(wire.id).toBe("task-123");
		expect(wire.contextId).toBe("ctx-456");
		const status = wire.status as {
			state: TaskState;
			message?: unknown;
			timestamp?: string;
		};
		expect(status.state).toBe("working");
		expect(status.message).toBeDefined();
		expect(status.timestamp).toBe("2026-09-11T10:00:00Z");
		expect(Array.isArray(wire.history)).toBe(true);
		expect(Array.isArray(wire.artifacts)).toBe(true);
		expect(wire.metadata).toEqual({ key: "value" });
	});

	test("parse snake_case: id, context_id, status.state, status.message, status.timestamp", () => {
		const wire = {
			id: "task-123",
			context_id: "ctx-456",
			status: {
				state: "completed",
				message: {
					role: "agent",
					message_id: "msg-1",
					parts: [{ text: "done" }],
				},
				timestamp: "2026-09-11T10:00:00Z",
			},
			history: [
				{
					role: "user",
					message_id: "msg-0",
					parts: [{ text: "start" }],
				},
			],
			artifacts: [
				{
					artifact_id: "art-1",
					name: "result",
					parts: [{ text: "done" }],
				},
			],
			metadata: { key: "value" },
		};
		const parsed = fromWireTask(wire);
		expect(parsed.taskId).toBe("task-123");
		expect(parsed.contextId).toBe("ctx-456");
		expect(parsed.status.state).toBe("completed");
		expect(parsed.status.message?.messageId).toBe("msg-1");
		expect(parsed.history?.[0]?.messageId).toBe("msg-0");
		expect(parsed.artifacts?.[0]?.artifactId).toBe("art-1");
	});

	test("round-trip preserves data", () => {
		const wire = toWireTask(sampleTask);
		const parsed = fromWireTask(wire);
		expect(parsed.taskId).toBe(sampleTask.taskId);
		expect(parsed.contextId).toBe(sampleTask.contextId);
		expect(parsed.status.state).toBe(sampleTask.status.state);
		expect(parsed.history?.length).toBe(sampleTask.history?.length);
		expect(parsed.artifacts?.length).toBe(sampleTask.artifacts?.length);
	});
});

describe("TaskStatusUpdateEvent serialization", () => {
	test("emit camelCase: taskId, contextId, status, final", () => {
		const event = {
			taskId: "task-1",
			contextId: "ctx-1",
			status: { state: "completed" as TaskState },
			final: true,
		};
		const wire = toWireTaskStatusUpdateEvent(event);
		expect(wire).toEqual({
			taskId: "task-1",
			contextId: "ctx-1",
			status: { state: "completed" },
			final: true,
		});
	});

	test("parse snake_case: task_id, context_id, status, final", () => {
		const wire = {
			task_id: "task-1",
			context_id: "ctx-1",
			status: { state: "working" },
			final: false,
		};
		const parsed = fromWireTaskStatusUpdateEvent(wire);
		expect(parsed.taskId).toBe("task-1");
		expect(parsed.contextId).toBe("ctx-1");
		expect(parsed.status.state).toBe("working");
		expect(parsed.final).toBe(false);
	});
});

describe("TaskArtifactUpdateEvent serialization", () => {
	test("emit camelCase: taskId, contextId, artifact, append, lastChunk", () => {
		const event = {
			taskId: "task-1",
			contextId: "ctx-1",
			artifact: {
				artifactId: "art-1",
				parts: [{ kind: "text" as const, text: "chunk" }],
			},
			append: true,
			lastChunk: false,
		};
		const wire = toWireTaskArtifactUpdateEvent(event);
		expect(wire.taskId).toBe("task-1");
		expect(wire.contextId).toBe("ctx-1");
		expect((wire.artifact as { artifactId: string }).artifactId).toBe("art-1");
		expect(wire.append).toBe(true);
		expect(wire.lastChunk).toBe(false);
	});

	test("parse snake_case: task_id, context_id, artifact, append, last_chunk", () => {
		const wire = {
			task_id: "task-1",
			context_id: "ctx-1",
			artifact: { artifact_id: "art-1", parts: [{ text: "chunk" }] },
			append: true,
			last_chunk: true,
		};
		const parsed = fromWireTaskArtifactUpdateEvent(wire);
		expect(parsed.taskId).toBe("task-1");
		expect(parsed.contextId).toBe("ctx-1");
		expect(parsed.artifact.artifactId).toBe("art-1");
		expect(parsed.append).toBe(true);
		expect(parsed.lastChunk).toBe(true);
	});
});

describe("StreamResponse serialization", () => {
	test("statusUpdate variant", () => {
		const resp = {
			statusUpdate: {
				taskId: "task-1",
				contextId: "ctx-1",
				status: { state: "working" as TaskState },
				final: false,
			},
		};
		const wire = toWireStreamResponse(resp);
		expect(wire.statusUpdate).toBeDefined();
		expect((wire.statusUpdate as { taskId: string } | undefined)?.taskId).toBe(
			"task-1",
		);
	});

	test("artifactUpdate variant", () => {
		const resp = {
			artifactUpdate: {
				taskId: "task-1",
				contextId: "ctx-1",
				artifact: {
					artifactId: "art-1",
					parts: [{ kind: "text" as const, text: "data" }],
				},
			},
		};
		const wire = toWireStreamResponse(resp);
		expect(wire.artifactUpdate).toBeDefined();
	});

	test("jsonRpcResponse variant", () => {
		const resp = {
			jsonRpcResponse: { result: { ok: true }, error: undefined },
		};
		const wire = toWireStreamResponse(resp);
		expect(wire.jsonRpcResponse).toEqual({
			result: { ok: true },
			error: undefined,
		});
	});

	test("parse snake_case status_update and artifact_update", () => {
		const wire = {
			status_update: {
				task_id: "task-1",
				context_id: "ctx-1",
				status: { state: "completed" },
				final: true,
			},
		};
		const parsed = fromWireStreamResponse(wire);
		if (!("statusUpdate" in parsed)) {
			throw new Error("expected statusUpdate variant");
		}
		expect(parsed.statusUpdate.taskId).toBe("task-1");
		expect(parsed.statusUpdate.final).toBe(true);
	});
});

describe("SendMessageRequest/Response serialization", () => {
	test("SendMessageRequest emit: message, notificationUrl, sendMessageConfiguration", () => {
		const req = {
			message: {
				role: "user" as const,
				messageId: "m1",
				parts: [{ kind: "text" as const, text: "hi" }],
			},
			notificationUrl: "https://webhook.example.com",
			sendMessageConfiguration: { historyLength: 10, returnImmediately: true },
		};
		const wire = toWireSendMessageRequest(req);
		expect(wire.message).toBeDefined();
		expect(wire.notificationUrl).toBe("https://webhook.example.com");
		const configuration = wire.configuration as {
			historyLength: number;
			returnImmediately: boolean;
		};
		expect(configuration.historyLength).toBe(10);
		expect(configuration.returnImmediately).toBe(true);
	});

	test("SendMessageResponse emit: task or message", () => {
		const resp = {
			task: { taskId: "t1", status: { state: "submitted" as TaskState } },
		};
		const wire = toWireSendMessageResponse(resp);
		expect(wire.task).toBeDefined();
		expect((wire.task as { id: string } | undefined)?.id).toBe("t1");
	});
});

describe("ListTasksRequest/Response serialization", () => {
	test("ListTasksRequest emit camelCase", () => {
		const req = {
			contextId: "ctx-1",
			status: "working" as TaskState,
			pageSize: 20,
		};
		const wire = toWireListTasksRequest(req);
		expect(wire.contextId).toBe("ctx-1");
		expect(wire.status).toBe("working");
		expect(wire.pageSize).toBe(20);
	});

	test("ListTasksResponse emit: tasks, nextPageToken, pageSize, totalSize", () => {
		const resp = {
			tasks: [{ taskId: "t1", status: { state: "completed" as TaskState } }],
			nextPageToken: "next-123",
			pageSize: 10,
			totalSize: 100,
		};
		const wire = toWireListTasksResponse(resp);
		expect(wire.tasks).toHaveLength(1);
		expect(wire.nextPageToken).toBe("next-123");
		expect(wire.pageSize).toBe(10);
		expect(wire.totalSize).toBe(100);
	});
});

describe("GetTaskRequest/CancelTaskRequest serialization", () => {
	test("GetTaskRequest emit: id, historyLength", () => {
		const wire = toWireGetTaskRequest({ id: "task-1", historyLength: 5 });
		expect(wire.id).toBe("task-1");
		expect(wire.historyLength).toBe(5);
	});

	test("CancelTaskRequest emit: id, metadata", () => {
		const wire = toWireCancelTaskRequest({
			id: "task-1",
			metadata: { reason: "user" },
		});
		expect(wire.id).toBe("task-1");
		expect(wire.metadata).toEqual({ reason: "user" });
	});
});

describe("AgentCard serialization", () => {
	const sampleCard: AgentCard = {
		name: "Test Agent",
		description: "A test agent",
		url: "https://agent.example.com",
		version: "1.0.0",
		supportedInterfaces: [
			{
				url: "https://agent.example.com/a2a",
				protocolBinding: "HTTP+JSON",
				protocolVersion: "1.0",
			},
		],
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
		capabilities: { streaming: true, pushNotifications: false },
		skills: [
			{
				id: "skill-1",
				name: "Skill 1",
				description: "Does something",
				tags: ["tag1"],
			},
		],
	};

	test("emit camelCase: name, description, url, version, supportedInterfaces, defaultInputModes, capabilities, skills", () => {
		const wire = toWireAgentCard(sampleCard);
		expect(wire.name).toBe("Test Agent");
		expect(wire.url).toBe("https://agent.example.com");
		expect(wire.version).toBe("1.0.0");
		expect(Array.isArray(wire.supportedInterfaces)).toBe(true);
		const supportedInterfaces = wire.supportedInterfaces as readonly {
			protocolBinding: string;
		}[];
		expect(supportedInterfaces[0]?.protocolBinding).toBe("HTTP+JSON");
		expect(wire.defaultInputModes).toEqual(["text/plain"]);
		expect(
			(wire.capabilities as { streaming?: boolean } | undefined)?.streaming,
		).toBe(true);
		expect(
			(wire.skills as readonly { id?: string }[] | undefined)?.[0]?.id,
		).toBe("skill-1");
	});

	test("parse snake_case: supported_interfaces, default_input_modes, default_output_modes, push_notifications", () => {
		const wire = {
			name: "Test Agent",
			url: "https://agent.example.com",
			version: "1.0.0",
			supported_interfaces: [
				{
					url: "https://agent.example.com/a2a",
					protocol_binding: "HTTP+JSON",
					protocol_version: "1.0",
				},
			],
			default_input_modes: ["text/plain"],
			default_output_modes: ["text/plain"],
			capabilities: { streaming: true, push_notifications: false },
			skills: [{ id: "skill-1", name: "Skill 1", tags: ["tag1"] }],
		};
		const parsed = fromWireAgentCard(wire);
		expect(parsed.name).toBe("Test Agent");
		expect(parsed.supportedInterfaces[0]?.protocolBinding).toBe("HTTP+JSON");
		expect(parsed.defaultInputModes).toEqual(["text/plain"]);
		expect(parsed.capabilities?.pushNotifications).toBe(false);
		expect(parsed.skills?.[0]?.id).toBe("skill-1");
	});
});

describe("ExtendedAgentCard serialization", () => {
	test("emit and parse agentCard field", () => {
		const card = {
			agentCard: {
				name: "Extended",
				url: "https://ext.example.com",
				version: "1.0.0",
				supportedInterfaces: [
					{
						url: "https://ext.example.com/a2a",
						protocolBinding: "HTTP+JSON",
						protocolVersion: "1.0",
					},
				],
				defaultInputModes: ["text/plain"],
			},
		};
		const wire = toWireExtendedAgentCard(card);
		expect(wire.agentCard).toBeDefined();
		const parsed = fromWireExtendedAgentCard(wire);
		expect(parsed.agentCard?.name).toBe("Extended");
	});
});

describe("Protocol binding constants in wire", () => {
	test("AgentInterface protocolBinding emits as HTTP+JSON", () => {
		const wire = toWireAgentCard({
			name: "Test",
			url: "https://a.com",
			version: "1.0",
			supportedInterfaces: [
				{
					url: "https://a.com/a2a",
					protocolBinding: "HTTP+JSON",
					protocolVersion: "1.0",
				},
			],
			defaultInputModes: ["text"],
		});
		const supportedInterfaces = wire.supportedInterfaces as readonly {
			protocolBinding: string;
		}[];
		expect(supportedInterfaces[0]?.protocolBinding).toBe("HTTP+JSON");
	});
});
