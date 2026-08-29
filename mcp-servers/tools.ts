import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerResources } from "@adapters/mcp-resources";
import { SubscriptionManager } from "@adapters/subscription-manager";
import pkg from "../package.json";

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

function sanitizeArgs(args: unknown): unknown {
  if (args === null || typeof args !== "object") return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = `${v.slice(0, 200)}… (${v.length} chars)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function logOk(name: string, start: number, result: unknown) {
  const ms = Math.round(performance.now() - start);
  let size: string | undefined;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((c) => (c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string" ? (c as { text: string }).text : ""))
        .join("");
      size = `${text.length} chars`;
    }
  }
  console.error(`[MCP tools] ${name} ok in ${ms}ms${size ? ` (${size})` : ""}`);
}

function withLogging<Args, R>(name: string, handler: (args: Args) => R): (args: Args) => R {
  return (args: Args) => {
    console.error(`[MCP tools] call ${name}`, sanitizeArgs(args));
    const start = performance.now();
    try {
      const result = handler(args);
      if (result instanceof Promise) {
        return result.then(
          (r) => {
            logOk(name, start, r);
            return r;
          },
          (e) => {
            console.error(`[MCP tools] ${name} error:`, e);
            throw e;
          },
        ) as R;
      }
      logOk(name, start, result);
      return result;
    } catch (e) {
      console.error(`[MCP tools] ${name} error:`, e);
      throw e;
    }
  };
}

server.registerTool("read_file", {
  description: "Read a file from the project workspace",
  inputSchema: { path: z.string().describe("Relative file path") },
}, withLogging("read_file", ({ path }) => {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) throw new Error(`File not found: ${path}`);
  const content = readFileSync(full, "utf-8");
  return { content: [{ type: "text", text: `File: ${path}\n\n${content}` }] };
}));

server.registerTool("write_file", {
  description: "Write content to a file in the project workspace",
  inputSchema: { path: z.string(), content: z.string() },
}, withLogging("write_file", ({ path, content }) => {
  const full = join(process.cwd(), path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return { content: [{ type: "text", text: `Written ${content.length} chars to ${path}` }] };
}));

server.registerTool("install_python_dependency", {
  description: "Install a Python package into the persistent environment",
  inputSchema: { pkgName: z.string().describe("Package name (e.g. 'requests', 'pandas')") },
}, withLogging("install_python_dependency", ({ pkgName }) => {
  ensurePythonEnv();
  const proc = Bun.spawnSync(["uv", "add", pkgName], {
    cwd: PYTHON_ENV_DIR,
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr);
    throw new Error(`Failed to install ${pkgName}: ${stderr}`);
  }
  return { content: [{ type: "text", text: `Successfully installed ${pkgName} into .python_env` }] };
}));

server.registerTool("run_python", {
  description: "Execute a Python snippet via uv in a persistent environment with dependency support",
  inputSchema: { code: z.string().describe("Python code to run") },
}, withLogging("run_python", ({ code }) => {
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
}));


type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let num = "";
      while (i < expression.length && ((expression[i]! >= "0" && expression[i]! <= "9") || expression[i] === ".")) {
        num += expression[i];
        i++;
      }
      const value = Number(num);
      if (!Number.isFinite(value)) throw new Error(`Invalid number: ${num}`);
      tokens.push({ kind: "num", value });
      continue;
    }
    if (ch === "(") { tokens.push({ kind: "lparen" }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen" }); i++; continue; }
    if ("+-*/%^".includes(ch)) { tokens.push({ kind: "op", value: ch }); i++; continue; }
    throw new Error(`Unsafe expression: illegal character "${ch}"`);
  }
  return tokens;
}

// Recursive-descent parser with precedence:
//   expr   := term (('+' | '-') term)*
//   term   := power (('*' | '/' | '%') power)*
//   power  := unary ('^' unary)*        (right-associative)
//   unary  := ('+' | '-') unary | primary
//   primary:= number | '(' expr ')'
class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): number {
    if (this.tokens.length === 0) throw new Error("Empty expression");
    const result = this.parseExpr();
    if (this.pos < this.tokens.length) throw new Error("Unexpected trailing input");
    return result;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    let tok = this.peek();
    while (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      this.next();
      const right = this.parseTerm();
      left = tok.value === "+" ? left + right : left - right;
      tok = this.peek();
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parsePower();
    let tok = this.peek();
    while (tok && tok.kind === "op" && (tok.value === "*" || tok.value === "/" || tok.value === "%")) {
      this.next();
      const right = this.parsePower();
      if (tok.value === "*") left = left * right;
      else if (tok.value === "/") {
        if (right === 0) throw new Error("Division by zero");
        left = left / right;
      } else {
        if (right === 0) throw new Error("Modulo by zero");
        left = left % right;
      }
      tok = this.peek();
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    const tok = this.peek();
    if (tok && tok.kind === "op" && tok.value === "^") {
      this.next();
      const exp = this.parsePower(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseUnary(): number {
    const tok = this.peek();
    if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      this.next();
      const val = this.parseUnary();
      return tok.value === "-" ? -val : val;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tok = this.next();
    if (!tok) throw new Error("Unexpected end of expression");
    if (tok.kind === "num") return tok.value;
    if (tok.kind === "lparen") {
      const inner = this.parseExpr();
      const close = this.next();
      if (!close || close.kind !== "rparen") throw new Error("Missing closing parenthesis");
      return inner;
    }
    throw new Error("Unexpected token in expression");
  }
}

function safeCalculate(expression: string): number {
  if (!/^[\d\s+\-*/.()%^]+$/.test(expression))
    throw new Error("Unsafe expression");
  return new Parser(tokenize(expression)).parse();
}

server.registerTool("calculate", {
  description: "Safe arithmetic evaluator",
  inputSchema: { expression: z.string().describe("Math expression") },
}, withLogging("calculate", ({ expression }) => {
  const result = safeCalculate(expression);
  return { content: [{ type: "text", text: String(result) }] };
}));

server.registerTool("save_skill", {
  description: "Persist a Hermes-style skill document to the skill store",
  inputSchema: {
    name: z.string(),
    description: z.string(),
    steps: z.array(z.string()),
    tags: z.array(z.string()).optional().default([]),
  },
}, withLogging("save_skill", ({ name: skillName, description, steps, tags }) => {
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
}));

server.registerTool("list_skills", {
  description: "List all saved skills from the skill store",
  inputSchema: {},
}, withLogging("list_skills", () => {
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
}));

registerResources(server, {
  subscriptions,
  projectRoot: process.cwd(),
  getWorldState: async (): Promise<any> => {
    try {
      const res = await fetch("http://localhost:4000/.well-known/world-state");
      if (!res.ok) throw new Error(`Orchestrator returned ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error("[MCP tools] getWorldState failed:", e);
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
    } catch (e) {
      console.error("[MCP tools] getTask failed:", e);
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
