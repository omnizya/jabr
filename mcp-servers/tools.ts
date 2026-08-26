/**
 * MCP Tool Server (Bun stdio transport)
 * Exposes: read_file · write_file · run_python · calculate · web_fetch_mock
 *
 * Wire into opencode.json or hermes config:
 *   { "type": "stdio", "command": "bun", "args": ["mcp-servers/tools.ts"] }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const server = new Server(
  { name: "agent-lab-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ── Tool catalogue ────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_file",
      description: "Read a file from the project workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write content to a file in the project workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "run_python",
      description: "Execute a Python snippet via uv — returns stdout",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Python code to run" },
        },
        required: ["code"],
      },
    },
    {
      name: "calculate",
      description: "Safe arithmetic evaluator",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression" },
        },
        required: ["expression"],
      },
    },
    {
      name: "save_skill",
      description: "Persist a Hermes-style skill document to the skill store",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "steps"],
      },
    },
    {
      name: "list_skills",
      description: "List all saved skills from the skill store",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "read_file": {
        const { path } = z.object({ path: z.string() }).parse(args);
        const full = join(process.cwd(), path);
        if (!existsSync(full)) throw new Error(`File not found: ${path}`);
        const content = readFileSync(full, "utf-8");
        return text(`File: ${path}\n\n${content}`);
      }

      case "write_file": {
        const { path, content } = z
          .object({ path: z.string(), content: z.string() })
          .parse(args);
        const full = join(process.cwd(), path);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, content, "utf-8");
        return text(`Written ${content.length} chars to ${path}`);
      }

      case "run_python": {
        const { code } = z.object({ code: z.string() }).parse(args);
        // Write temp file and run via uv
        const tmpPath = `/tmp/agent_lab_${Date.now()}.py`;
        writeFileSync(tmpPath, code, "utf-8");
        const proc = Bun.spawnSync(["uv", "run", "--quiet", tmpPath], {
          timeout: 10_000,
        });
        const stdout = new TextDecoder().decode(proc.stdout);
        const stderr = new TextDecoder().decode(proc.stderr);
        if (proc.exitCode !== 0) throw new Error(stderr || "Python error");
        return text(stdout || "(no output)");
      }

      case "calculate": {
        const { expression } = z.object({ expression: z.string() }).parse(args);
        // Safe eval — only numbers and operators
        if (!/^[\d\s+\-*/.()%^]+$/.test(expression))
          throw new Error("Unsafe expression");
        // eslint-disable-next-line no-eval
        const result = eval(expression);
        return text(String(result));
      }

      case "save_skill": {
        const {
          name: skillName,
          description,
          steps,
          tags,
        } = z
          .object({
            name: z.string(),
            description: z.string(),
            steps: z.array(z.string()),
            tags: z.array(z.string()).optional().default([]),
          })
          .parse(args);

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
        writeFileSync(
          join(skillDir, `${slug}.json`),
          JSON.stringify(doc, null, 2),
        );
        return text(`Skill "${skillName}" saved → skills/${slug}.json`);
      }

      case "list_skills": {
        const skillDir = join(process.cwd(), "skills");
        if (!existsSync(skillDir)) return text("No skills yet.");
        const { readdirSync } = await import("fs");
        const files = readdirSync(skillDir).filter((f) => f.endsWith(".json"));
        const skills = files.map((f) => {
          const doc = JSON.parse(readFileSync(join(skillDir, f), "utf-8"));
          return `• ${doc.name} — ${doc.description} [${doc.tags.join(", ")}]`;
        });
        return text(skills.length ? skills.join("\n") : "No skills yet.");
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP tool server running on stdio");
