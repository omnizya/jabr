import { describe, test, expect } from "bun:test";
import { DynamicRegistry } from "@adapters/dynamic-registry";
import type { AgentCard, AgentSkill } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";

// Offline registry: returns cards keyed by seed URL. Same shape DynamicRegistry
// would see from A2AClient.fetchCard against a running agent — keeps routing
// tests on the real matchAgent algorithm without needing live agents.
const SKILLS: Record<string, AgentSkill[]> = {
  oracle: [{ name: "Code Review", description: "", tags: ["review", "simplify", "refactor", "architecture", "audit"] }],
  librarian: [{ name: "Research", description: "", tags: ["research", "doc", "api", "library", "how-to", "summarize"] }],
  explorer: [{ name: "Scan", description: "", tags: ["find", "files", "map", "structure", "grep", "search"] }],
  designer: [{ name: "UI", description: "", tags: ["layout", "responsive", "ui", "component", "button", "ux", "color", "palette"] }],
  fixer: [{ name: "Implement", description: "", tags: ["fix", "bug", "error", "patch", "repair", "debug", "code", "implement", "function", "algorithm", "typescript", "write", "python", "review"] }],
};

const seed = {
  oracle: "http://localhost:4001",
  librarian: "http://localhost:4002",
  explorer: "http://localhost:4003",
  designer: "http://localhost:4004",
  fixer: "http://localhost:4005",
};

const urlToName: Record<string, string> = {};
for (const [k, v] of Object.entries(seed)) urlToName[v] = k;

function makeOfflineRegistry(): AgentRegistryPort {
  return {
    async fetchCard(url: string): Promise<AgentCard | null> {
      const name = urlToName[url];
      if (!name) return null;
      return {
        name: `${name[0]?.toUpperCase()}${name.slice(1)} Agent`,
        description: "",
        url,
        version: "1.0.0",
        capabilities: {},
        skills: SKILLS[name] ?? [],
      };
    },
    async delegateTask() {
      return "";
    },
  };
}

function makeRegistry(): DynamicRegistry {
  return new DynamicRegistry(makeOfflineRegistry(), seed);
}

describe("DynamicRegistry.matchAgent", () => {
  test("routes a file-search task to explorer", async () => {
    const dyn = makeRegistry();
    await dyn.initialize();
    const match = await dyn.matchAgent("find all the files in the project structure");
    expect(match).not.toBeNull();
    expect(match?.name).toBe("explorer");
  });

  test("routes a bug-fix task to fixer", async () => {
    const dyn = makeRegistry();
    await dyn.initialize();
    const match = await dyn.matchAgent("fix the bug in this function and patch the error");
    expect(match).not.toBeNull();
    expect(match?.name).toBe("fixer");
  });

  test("falls back to the first registered agent when nothing matches", async () => {
    const dyn = makeRegistry();
    await dyn.initialize();
    // No agent tags relate to boiling water — should fall back to the first
    // registered seed agent (oracle).
    const match = await dyn.matchAgent("please boil water for a cup of tea");
    expect(match).not.toBeNull();
    expect(match?.name).toBe("oracle");
  });

  test("returns null when the registry is empty", async () => {
    const emptyRegistry: AgentRegistryPort = {
      async fetchCard() {
        return null;
      },
      async delegateTask() {
        return "";
      },
    };
    const dyn = new DynamicRegistry(emptyRegistry, {});
    // Bypass the discovery retry loop so the empty-entries branch is exercised
    // directly (matchAgent returns null when no agents are registered).
    (dyn as unknown as { ensureReady: () => Promise<void> }).ensureReady = async () => {};
    const match = await dyn.matchAgent("find the bug in this file");
    expect(match).toBeNull();
  });
});
