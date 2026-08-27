import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { registerResources } from "@adapters/mcp-resources";
import { SubscriptionManager } from "@adapters/subscription-manager";
import pkg from "../package.json"

const subscriptions = new SubscriptionManager();

const server = new McpServer(
  { name: "jabr-tools", version: pkg.version },
  {
    capabilities: { resources: { subscribe: true, listChanged: true } },
  },
);

server.registerTool("read_file", {
  description: "Read a file from the project workspace",
  inputSchema: { path: z.string().describe("Relative file path") },
}, ({ path }) => {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) throw new Error(`File not found: ${path}`);
  const content = readFileSync(full, "utf-8");
  return { content: [{ type: "text", text: `File: ${path}\n\n${content}` }] };
});

server.registerTool("write_file", {
  description: "Write content to a file in the project workspace",
  inputSchema: { path: z.string(), content: z.string() },
}, ({ path, content }) => {
  const full = join(process.cwd(), path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return { content: [{ type: "text", text: `Written ${content.length} chars to ${path}` }] };
});

server.registerTool("run_python", {
  description: "Execute a Python snippet via uv — returns stdout",
  inputSchema: { code: z.string().describe("Python code to run") },
}, ({ code }) => {
  const tmpPath = `/tmp/agent_lab_${Date.now()}.py`;
  writeFileSync(tmpPath, code, "utf-8");
  const proc = Bun.spawnSync(["uv", "run", "--quiet", tmpPath], {
    timeout: 10_000,
  });
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  if (proc.exitCode !== 0) throw new Error(stderr || "Python error");
  return { content: [{ type: "text", text: stdout || "(no output)" }] };
});

server.registerTool("calculate", {
  description: "Safe arithmetic evaluator",
  inputSchema: { expression: z.string().describe("Math expression") },
}, ({ expression }) => {
  if (!/^[\d\s+\-*/.()%^]+$/.test(expression))
    throw new Error("Unsafe expression");
  const result = eval(expression);
  return { content: [{ type: "text", text: String(result) }] };
});

server.registerTool("save_skill", {
  description: "Persist a Hermes-style skill document to the skill store",
  inputSchema: {
    name: z.string(),
    description: z.string(),
    steps: z.array(z.string()),
    tags: z.array(z.string()).optional().default([]),
  },
}, ({ name: skillName, description, steps, tags }) => {
  const skillDir = join(process.cwd(), "skills");
  mkdirSync(skillDir, { recursive: true });
  const slug = skillName.toLowerCase().replace(/\s+/g, "-");
  const doc = {
    name: skillName,
    description,
    tags,
    steps,
    createdAt: new Date().toISOString(),
    usageCount: 0,
    successRate: 1.0,
  };
  writeFileSync(join(skillDir, `${slug}.json`), JSON.stringify(doc, null, 2));
  return { content: [{ type: "text", text: `Skill "${skillName}" saved → skills/${slug}.json` }] };
});

server.registerTool("list_skills", {
  description: "List all saved skills from the skill store",
  inputSchema: {},
}, () => {
  const skillDir = join(process.cwd(), "skills");
  if (!existsSync(skillDir))
    return { content: [{ type: "text", text: "No skills yet." }] };
  const files = readdirSync(skillDir).filter((f) => f.endsWith(".json"));
  const skills = files.map((f) => {
    const doc = JSON.parse(readFileSync(join(skillDir, f), "utf-8"));
    return `• ${doc.name} — ${doc.description} [${doc.tags.join(", ")}]`;
  });
  return {
    content: [{ type: "text", text: skills.length ? skills.join("\n") : "No skills yet." }],
  };
});

registerResources(server, {
  subscriptions,
  projectRoot: process.cwd(),
  getWorldState: async () => {
    const memoryDir = join(process.cwd(), "memory");
    const skillsDir = join(process.cwd(), "skills");
    const memPath = join(memoryDir, "orchestrator.md");

    let lastUpdated: string | undefined;
    if (existsSync(memPath)) {
      try {
        lastUpdated = statSync(memPath).mtime.toISOString();
      } catch {
        lastUpdated = undefined;
      }
    }

    let skillTotal = 0;
    let recentSlugs: string[] = [];
    if (existsSync(skillsDir)) {
      const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith(".json"));
      skillTotal = skillFiles.length;
      recentSlugs = skillFiles
        .map((f) => f.replace(/\.json$/, ""))
        .reverse()
        .slice(0, 5);
    }

    let taskTotal = 0;
    if (existsSync(memoryDir)) {
      taskTotal = readdirSync(memoryDir).filter(
        (f) => f.startsWith("task-") && f.endsWith(".json"),
      ).length;
    }

    return {
      timestamp: new Date().toISOString(),
      agents: [],
      tasks: { total: taskTotal, active: 0, completed: 0, failed: 0 },
      memory: { totalEntries: lastUpdated ? 1 : 0, lastUpdated },
      skills: { total: skillTotal, recentSlugs },
    };
  },
  getTask: async (taskId: string) => {
    const taskPath = join(process.cwd(), "memory", `task-${taskId}.json`);
    if (!existsSync(taskPath)) {
      return {
        id: taskId,
        status: "not_found",
        error: `No task found with id "${taskId}"`,
      };
    }
    try {
      return JSON.parse(readFileSync(taskPath, "utf-8"));
    } catch {
      return {
        id: taskId,
        status: "error",
        error: "Failed to parse task file",
      };
    }
  },
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP tool server running on stdio");
