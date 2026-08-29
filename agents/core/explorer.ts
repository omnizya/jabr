import type { TaskStorePort } from "@ports/task-store";
import type { AgentCard } from "@agents/types";

export const EXPLORER_CARD: AgentCard = {
  name: "BATTUTA",
  description: "BATTUTA (ابن بطوطة) — Astrolabe Voyager. Explores codebases, finds files and patterns, maps project structure. Fast reconnaissance.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    { name: "Find files", description: "Locate files by name pattern or content", tags: ["find", "files", "locate"], inputModes: ["text"], outputModes: ["text", "data"] },
    { name: "Map structure", description: "Generate a project directory overview", tags: ["map", "structure", "overview"], inputModes: ["text"], outputModes: ["text"] },
    { name: "Search code", description: "Find code patterns via regex or AST matching", tags: ["grep", "search", "pattern", "code-search"], inputModes: ["text"], outputModes: ["text", "data"] },
  ],
};

export class ExplorerAgent {
  constructor(private taskStore: TaskStorePort) { }

  get card(): AgentCard {
    return EXPLORER_CARD;
  }

  executeTask(userText: string): string {
    const lower = userText.toLowerCase();

    if (lower.includes("find") || lower.includes("where") || lower.includes("file")) {
      return `## File Discovery\n\nSearching for: "${userText}"\n\nUse the MCP tools for actual file operations:\n- \`read_file\` to inspect a specific file\n- \`list_skills\` to see saved patterns\n\nTip: Combine with grep for content-based search.`;
    }

    if (lower.includes("map") || lower.includes("structure") || lower.includes("overview") || lower.includes("architecture")) {
      return `## Project Map\n\nCurrent project: Jabr\n\n\`\`\`\nagents/\n├── core/          # Domain logic (orchestrator, fixer, librarian, oracle, explorer, designer)\n├── ports/         # Interfaces (agent-registry, task-store, memory-store, skill-store)\n├── adapters/      # Implementations (http servers, filesystem stores)\n├── run/           # Composition roots (wire ports → core)\n└── types.ts       # Shared types\nmcp-servers/\n└── tools.ts       # MCP tool server\nscripts/\n└── demo.ts        # Integration tests\nskills/            # Auto-generated skill documents\nmemory/            # Session memory (append-only)\n\`\`\`\n\nKey: 6 agents on ports 4000-4005, each a standalone A2A HTTP server.`;
    }

    if (lower.includes("grep") || lower.includes("search") || lower.includes("pattern")) {
      return `## Code Search\n\nSearching for: "${userText}"\n\nUse MCP tools for actual grep:\n- \`read_file\` for specific file content\n- \`run_python\` for custom search scripts\n\nAST-aware search available via external tools.`;
    }

    return `Explorer ready. Ask me to:\n- Find files or patterns in the codebase\n- Map the project structure\n- Search code with grep or regex`;
  }

  async execute(taskId: string, userText: string): Promise<void> {
    const text = this.executeTask(userText);
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
