import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { registerResources } from "@adapters/mcp-resources";
import { SubscriptionManager } from "@adapters/subscription-manager";
import pkg from "../package.json"

const subscriptions = new SubscriptionManager();

const PYTHON_ENV_DIR = join(process.cwd(), ".python_env");

function ensurePythonEnv() {
  if (!existsSync(PYTHON_ENV_DIR)) {
    mkdirSync(PYTHON_ENV_DIR, { recursive: true });
    Bun.spawnSync(["uv", "init", "--lib", PYTHON_ENV_DIR]);
  }
}

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

server.registerTool("install_python_dependency", {
  description: "Install a Python package into the persistent environment",
  inputSchema: { package: z.string().describe("Package name (e.g. 'requests', 'pandas')") },
}, ({ package }) => {
  ensurePythonEnv();
  const proc = Bun.spawnSync(["uv", "add", package], {
    cwd: PYTHON_ENV_DIR,
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr);
    throw new Error(`Failed to install ${package}: ${stderr}`);
  }
  return { content: [{ type: "text", text: `Successfully installed ${package} into .python_env` }] };
});

server.registerTool("run_python", {
  description: "Execute a Python snippet via uv in a persistent environment with dependency support",
  inputSchema: { code: z.string().describe("Python code to run") },
}, ({ code }) => {
  ensurePythonEnv();
  const mainPath = join(PYTHON_ENV_DIR, "main.py");
  writeFileSync(mainPath, code, "utf-8");
  
  const proc = Bun.spawnSync(["uv", "run", "--project", PYTHON_ENV_DIR, "python", "main.py"], {
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
    try {
      const res = await fetch("http://localhost:4000/.well-known/world-state");
      if (!res.ok) throw new Error(`Orchestrator returned ${res.status}`);
      return await res.json();
    } catch (e) {
      return { 
        timestamp: new Date().toISOString(), 
        agents: [], 
        error: `Could not fetch world state from Orchestrator: ${String(e)}` 
      };
    }
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
