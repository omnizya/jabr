import type { AgentCard } from "@agents/types";
import type { McpToolPort } from "@ports/mcp-tool-port";
import type { TaskStorePort } from "@ports/task-store";

export const EXPLORER_CARD: AgentCard = {
	name: "BATTUTA",
	description:
		"BATTUTA (ابن بطوطة) — Astrolabe Voyager. Explores codebases, finds files and patterns, maps project structure. Fast reconnaissance.",
	url: "",
	version: "1.0.0",
	capabilities: {
		streaming: true,
		pushNotifications: false,
		stateTransitionHistory: true,
	},
	securitySchemes: {},
	securityRequirements: [],
	skills: [
		{
			name: "Find files",
			description: "Locate files by name pattern or content",
			tags: ["find", "files", "locate"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
		{
			name: "Map structure",
			description: "Generate a project directory overview",
			tags: ["map", "structure", "overview"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
		{
			name: "Search code",
			description: "Find code patterns via regex or AST matching",
			tags: ["grep", "search", "pattern", "code-search"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
		{
			name: "Pack codebase",
			description:
				"Pack the entire repository into an AI-friendly file for context analysis",
			tags: ["pack", "codebase", "context", "token-count"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
		{
			name: "Search packed code",
			description:
				"Search the packed repository output using regex patterns",
			tags: ["grep", "search", "pattern", "packed"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
	],
	pricing: { costPerTask: 5 },
};

export class ExplorerAgent {
	constructor(
		private taskStore: TaskStorePort,
		private mcpTools?: McpToolPort,
	) {}

	get card(): AgentCard {
		return EXPLORER_CARD;
	}

	async executeTask(userText: string): Promise<string> {
		const lower = userText.toLowerCase();

		// Repomix-powered operations (require McpToolPort)
		if (
			this.mcpTools &&
			(lower.includes("pack") ||
				lower.includes("codebase") ||
				lower.includes("context"))
		) {
			try {
				const result = await this.mcpTools.callTool("pack_repository", {});
				return `## Repository Packed\n\n${result.content}`;
			} catch (e) {
				console.error("[Explorer] pack_repository failed:", e);
				return `## Pack Failed\n\nCould not pack repository: ${e}`;
			}
		}

		if (
			this.mcpTools &&
			(lower.includes("grep") ||
				lower.includes("search") ||
				lower.includes("pattern"))
		) {
			// Extract search pattern from user text (remove common prefixes)
			const pattern = userText
				.replace(/^(search|grep|find|look)\s*(for)?\s*/i, "")
				.trim();
			if (!pattern) {
				return `## Code Search\n\nPlease provide a search pattern.\nExample: \`search for "TaskStorePort"\``;
			}
			try {
				const result = await this.mcpTools.callTool("grep_repomix_output", {
					pattern,
					contextLines: 2,
				});
				return `## Search Results\n\n${result.content}`;
			} catch (e) {
				console.error("[Explorer] grep_repomix_output failed:", e);
				return `## Search Failed\n\nCould not search packed code: ${e}\n\nTip: Run "pack codebase" first to generate the packed output.`;
			}
		}

		if (
			this.mcpTools &&
			(lower.includes("read") ||
				lower.includes("show") ||
				lower.includes("content"))
		) {
			try {
				const result = await this.mcpTools.callTool("read_repomix_output", {});
				// Truncate if too large for a response
				const text = result.content;
				if (text.length > 50_000) {
					return `## Packed Repository (truncated)\n\n${text.slice(0, 50_000)}\n\n... (${text.length} total chars, showing first 50k)`;
				}
				return `## Packed Repository\n\n${text}`;
			} catch (e) {
				console.error("[Explorer] read_repomix_output failed:", e);
				return `## Read Failed\n\nCould not read packed output: ${e}\n\nTip: Run "pack codebase" first.`;
			}
		}

		// Original keyword-matched operations
		if (
			lower.includes("find") ||
			lower.includes("where") ||
			lower.includes("file")
		) {
			return `## File Discovery\n\nSearching for: "${userText}"\n\nUse the MCP tools for actual file operations:\n- \`read_file\` to inspect a specific file\n- \`list_skills\` to see saved patterns\n\nTip: Combine with grep for content-based search.`;
		}

		if (
			lower.includes("map") ||
			lower.includes("structure") ||
			lower.includes("overview") ||
			lower.includes("architecture")
		) {
			return `## Project Map\n\nCurrent project: Jabr\n\n\`\`\`\nagents/\n├── core/          # Domain logic (orchestrator, fixer, librarian, oracle, explorer, designer)\n├── ports/         # Interfaces (agent-registry, task-store, memory-store, skill-store)\n├── adapters/      # Implementations (http servers, filesystem stores)\n├── run/           # Composition roots (wire ports → core)\n└── types.ts       # Shared types\nmcp-servers/\n└── tools.ts       # MCP tool server\nscripts/\n└── demo.ts        # Integration tests\nskills/            # Auto-generated skill documents\nmemory/            # Session memory (append-only)\n\`\`\`\n\nKey: 6 agents on ports 4000-4005, each a standalone A2A HTTP server.`;
		}

		return `Explorer ready. Ask me to:\n- Find files or patterns in the codebase\n- Map the project structure\n- Pack the codebase for AI analysis (e.g. "pack codebase")\n- Search packed code with regex (e.g. "search for pattern")`;
	}

	async execute(taskId: string, userText: string): Promise<void> {
		console.log(`[Explorer] exploring task ${taskId}: ${userText}`);
		const text = await this.executeTask(userText);
		this.taskStore.updateState(taskId, "completed");
		this.taskStore.appendMessage(taskId, {
			messageId: crypto.randomUUID(),
			role: "agent",
			kind: "message",
			parts: [{ kind: "text", text }],
			contextId: taskId,
			taskId,
		});
	}
}
