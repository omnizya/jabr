import type { AgentCard, SkillDocument } from "@agents/types";
import type { LlmPort } from "@ports/llm-port";
import type { SearchPort } from "@ports/search-port";
import type { McpToolPort } from "@ports/mcp-tool-port";
import type { SkillStorePort } from "@ports/skill-store";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { BudgetPort } from "@ports/budget-port";

export const JARVIS_CARD: AgentCard = {
  name: "Jarvis Agent",
  description:
    "Proactive codebase steward — scans for improvements, generates profiles, watches dependencies, identifies AI/automation opportunities.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    {
      name: "Codebase scan",
      description: "Detects anti-patterns, dead code, complexity hotspots, and security risks",
      tags: ["scan", "audit", "anti-pattern", "dead-code", "complexity", "security"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Profile generation",
      description: "Creates agent profiles and skills for recurring codebase patterns",
      tags: ["profile", "agent-profile", "skill-creation", "pattern"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Dependency watch",
      description: "Monitors outdated packages, security advisories, and version drift",
      tags: ["dependency", "outdated", "security", "audit", "package"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Test gap analysis",
      description: "Identifies untested paths, missing edge cases, and flaky tests",
      tags: ["test", "coverage", "edge-case", "flaky", "gap"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Doc sync",
      description: "Detects docs diverged from code, missing READMEs, stale ADRs",
      tags: ["doc", "readme", "adr", "changelog", "drift"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "AI enhancement",
      description: "Identifies where LLMs/agents could automate workflows",
      tags: ["ai", "llm", "automation", "agentic", "enhancement"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
  ],
};

export type FindingSeverity = "info" | "warn" | "critical";
export type FindingCategory =
  | "anti-pattern"
  | "dead-code"
  | "complexity"
  | "security"
  | "test-gap"
  | "doc-drift"
  | "ai-opportunity";

export interface Finding {
  severity: FindingSeverity;
  category: FindingCategory;
  file: string;
  line?: number;
  message: string;
  suggestion: string;
  autoFixable: boolean;
}

export interface ScanReport {
  timestamp: string;
  workspacePath: string;
  findings: Finding[];
  profilesGenerated: SkillDocument[];
  tasksCreated: string[];
}

export interface DependencyReport {
  outdated: Array<{ name: string; current: string; latest: string }>;
  securityAdvisories: Array<{ name: string; severity: string; title: string }>;
  timestamp: string;
}

export interface TestGapReport {
  untestedFiles: string[];
  lowCoverageFiles: Array<{ file: string; coverage: number }>;
  missingEdgeCases: Array<{ file: string; edgeCase: string }>;
  timestamp: string;
}

export interface DocSyncReport {
  missingReadmes: string[];
  staleAdrs: Array<{ file: string; lastUpdated: string }>;
  undocumentedFiles: string[];
  timestamp: string;
}

export interface AIEnhancementReport {
  opportunities: Array<{
    file: string;
    description: string;
    effort: "low" | "medium" | "high";
    impact: "low" | "medium" | "high";
  }>;
  timestamp: string;
}

export interface StewardReport {
  scan: ScanReport;
  dependencies: DependencyReport;
  testGaps: TestGapReport;
  docSync: DocSyncReport;
  aiEnhancements: AIEnhancementReport;
  summary: string;
}

export class JarvisAgent {
  constructor(
    private llm: LlmPort,
    private search: SearchPort,
    private mcpTools: McpToolPort,
    private skillStore: SkillStorePort,
    private knowledge?: KnowledgePort,
    private budget?: BudgetPort,
  ) {}

  get card(): AgentCard {
    return JARVIS_CARD;
  }

  async scanCodebase(workspacePath: string): Promise<ScanReport> {
    const findings: Finding[] = [];
    const profilesGenerated: SkillDocument[] = [];
    const tasksCreated: string[] = [];

    const scanPrompt = `Analyze the codebase at ${workspacePath} for:
1. Anti-patterns (tight coupling, god objects, magic numbers)
2. Dead code (unused exports, unreachable branches)
3. Complexity hotspots (high cyclomatic complexity, deep nesting)
4. Security risks (hardcoded secrets, missing input validation)

Return a JSON array of findings: [{severity, category, file, line, message, suggestion, autoFixable}]`;

    try {
      const response = await this.llm.generate({
        prompt: scanPrompt,
        systemPrompt:
          "You are a senior code auditor. Analyze code quality and return structured findings.",
        maxTokens: 4000,
      });

      const parsed = this.extractJson(response.text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          findings.push({
            severity: item.severity ?? "info",
            category: item.category ?? "anti-pattern",
            file: item.file ?? "unknown",
            line: item.line,
            message: item.message ?? "",
            suggestion: item.suggestion ?? "",
            autoFixable: item.autoFixable ?? false,
          });
        }
      }
    } catch (err) {
      console.error("[Jarvis] Codebase scan LLM call failed:", err);
    }

    const profile = this.extractProfileFromFindings(findings);
    if (profile) {
      const slug = `jarvis-scan-${Date.now()}`;
      if (!this.skillStore.exists(slug)) {
        this.skillStore.save(slug, profile);
        profilesGenerated.push(profile);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      workspacePath,
      findings,
      profilesGenerated,
      tasksCreated,
    };
  }

  async watchDependencies(
    workspacePath: string,
  ): Promise<DependencyReport> {
    const outdated: DependencyReport["outdated"] = [];
    const securityAdvisories: DependencyReport["securityAdvisories"] = [];

    try {
      const result = await this.mcpTools.callTool("read_file", {
        path: `${workspacePath}/package.json`,
      });

      if (!result.isError && result.content) {
        // MCP read_file returns "File: ${path}\n\n${content}" — extract JSON
        const raw = result.content;
        const jsonStart = raw.indexOf("{");
        const jsonEnd = raw.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          const pkg = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          for (const [name, version] of Object.entries(deps)) {
            const latest = await this.fetchLatestVersion(name);
            if (latest && latest !== version) {
              outdated.push({
                name,
                current: version as string,
                latest,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[Jarvis] Dependency watch failed:", err);
    }

    return {
      outdated,
      securityAdvisories,
      timestamp: new Date().toISOString(),
    };
  }

  async analyzeTestGaps(workspacePath: string): Promise<TestGapReport> {
    const untestedFiles: string[] = [];
    const lowCoverageFiles: TestGapReport["lowCoverageFiles"] = [];
    const missingEdgeCases: TestGapReport["missingEdgeCases"] = [];

    const gapPrompt = `Analyze test coverage for the codebase at ${workspacePath}.
Identify:
1. Source files with no corresponding test files
2. Files with low test coverage (< 50%)
3. Missing edge case tests (null inputs, empty arrays, boundary values)

Return JSON: {untestedFiles[], lowCoverageFiles[{file, coverage}], missingEdgeCases[{file, edgeCase}]}`;

    try {
      const response = await this.llm.generate({
        prompt: gapPrompt,
        systemPrompt:
          "You are a test coverage analyst. Identify gaps in test coverage.",
        maxTokens: 3000,
      });

      const parsed = this.extractJson(response.text);
      if (parsed) {
        if (Array.isArray(parsed.untestedFiles)) {
          untestedFiles.push(...parsed.untestedFiles);
        }
        if (Array.isArray(parsed.lowCoverageFiles)) {
          lowCoverageFiles.push(...parsed.lowCoverageFiles);
        }
        if (Array.isArray(parsed.missingEdgeCases)) {
          missingEdgeCases.push(...parsed.missingEdgeCases);
        }
      }
    } catch (err) {
      console.error("[Jarvis] Test gap analysis failed:", err);
    }

    return {
      untestedFiles,
      lowCoverageFiles,
      missingEdgeCases,
      timestamp: new Date().toISOString(),
    };
  }

  async syncDocs(workspacePath: string): Promise<DocSyncReport> {
    const missingReadmes: string[] = [];
    const staleAdrs: DocSyncReport["staleAdrs"] = [];
    const undocumentedFiles: string[] = [];

    const docPrompt = `Check documentation health for the codebase at ${workspacePath}.
Identify:
1. Directories missing README.md
2. ADRs (Architecture Decision Records) that are stale (> 6 months old)
3. Public APIs/modules without documentation

Return JSON: {missingReadmes[], staleAdrs[{file, lastUpdated}], undocumentedFiles[]}`;

    try {
      const response = await this.llm.generate({
        prompt: docPrompt,
        systemPrompt:
          "You are a documentation specialist. Identify documentation gaps.",
        maxTokens: 3000,
      });

      const parsed = this.extractJson(response.text);
      if (parsed) {
        if (Array.isArray(parsed.missingReadmes)) {
          missingReadmes.push(...parsed.missingReadmes);
        }
        if (Array.isArray(parsed.staleAdrs)) {
          staleAdrs.push(...parsed.staleAdrs);
        }
        if (Array.isArray(parsed.undocumentedFiles)) {
          undocumentedFiles.push(...parsed.undocumentedFiles);
        }
      }
    } catch (err) {
      console.error("[Jarvis] Doc sync failed:", err);
    }

    return {
      missingReadmes,
      staleAdrs,
      undocumentedFiles,
      timestamp: new Date().toISOString(),
    };
  }

  async identifyAIEnhancements(
    workspacePath: string,
  ): Promise<AIEnhancementReport> {
    const opportunities: AIEnhancementReport["opportunities"] = [];

    const aiPrompt = `Identify AI/LLM automation opportunities in the codebase at ${workspacePath}.
Look for:
1. Repetitive code patterns that could be generated
2. Manual review processes that could be automated
3. Documentation that could be auto-generated
4. Test boilerplate that could be synthesized
5. Refactoring patterns that could be detected and applied

Return JSON: {opportunities[{file, description, effort, impact}]}`;

    try {
      const response = await this.llm.generate({
        prompt: aiPrompt,
        systemPrompt:
          "You are an AI automation consultant. Identify where LLMs can improve developer workflows.",
        maxTokens: 3000,
      });

      const parsed = this.extractJson(response.text);
      if (parsed && Array.isArray(parsed.opportunities)) {
        opportunities.push(...parsed.opportunities);
      }
    } catch (err) {
      console.error("[Jarvis] AI enhancement identification failed:", err);
    }

    return {
      opportunities,
      timestamp: new Date().toISOString(),
    };
  }

  async steward(workspacePath: string): Promise<StewardReport> {
    console.log(`[Jarvis] Starting steward scan of ${workspacePath}...`);

    const [scan, dependencies, testGaps, docSync, aiEnhancements] =
      await Promise.all([
        this.scanCodebase(workspacePath),
        this.watchDependencies(workspacePath),
        this.analyzeTestGaps(workspacePath),
        this.syncDocs(workspacePath),
        this.identifyAIEnhancements(workspacePath),
      ]);

    const totalFindings =
      scan.findings.length +
      dependencies.outdated.length +
      testGaps.untestedFiles.length +
      docSync.missingReadmes.length +
      aiEnhancements.opportunities.length;

    const summary = `Steward scan complete: ${totalFindings} findings (${scan.findings.length} code quality, ${dependencies.outdated.length} outdated deps, ${testGaps.untestedFiles.length} untested files, ${docSync.missingReadmes.length} missing docs, ${aiEnhancements.opportunities.length} AI opportunities)`;

    console.log(`[Jarvis] ${summary}`);

    if (this.knowledge) {
      try {
        await this.knowledge.store(
          `jarvis-steward-${Date.now()}`,
          summary,
          ["jarvis", "steward", "scan"],
        );
      } catch (err) {
        console.error("[Jarvis] Knowledge store failed:", err);
      }
    }

    return {
      scan,
      dependencies,
      testGaps,
      docSync,
      aiEnhancements,
      summary,
    };
  }

  async execute(taskId: string, userText: string): Promise<void> {
    const lower = userText.toLowerCase();
    const workspace = process.cwd();

    if (lower.includes("scan") || lower.includes("steward")) {
      const report = await this.steward(workspace);
      this.storeResult(taskId, report.summary);
      return;
    }

    if (lower.includes("dependency") || lower.includes("package")) {
      const report = await this.watchDependencies(workspace);
      this.storeResult(
        taskId,
        `Dependency watch: ${report.outdated.length} outdated packages found.`,
      );
      return;
    }

    if (lower.includes("test") || lower.includes("coverage")) {
      const report = await this.analyzeTestGaps(workspace);
      this.storeResult(
        taskId,
        `Test gap analysis: ${report.untestedFiles.length} untested files, ${report.missingEdgeCases.length} missing edge cases.`,
      );
      return;
    }

    if (lower.includes("doc") || lower.includes("readme")) {
      const report = await this.syncDocs(workspace);
      this.storeResult(
        taskId,
        `Doc sync: ${report.missingReadmes.length} missing READMEs, ${report.staleAdrs.length} stale ADRs.`,
      );
      return;
    }

    if (lower.includes("ai") || lower.includes("automat")) {
      const report = await this.identifyAIEnhancements(workspace);
      this.storeResult(
        taskId,
        `AI enhancements: ${report.opportunities.length} opportunities identified.`,
      );
      return;
    }

    this.storeResult(
      taskId,
      "Jarvis ready. Commands: scan, dependencies, test gaps, docs, AI enhancements.",
    );
  }

  private storeResult(taskId: string, text: string): void {
    // TaskStorePort is not directly available here; result is returned via A2AServer
    console.log(`[Jarvis] ${text}`);
  }

  private extractJson(text: string): any {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
      const arrStart = text.indexOf("[");
      const arrEnd = text.lastIndexOf("]");
      if (arrStart !== -1 && arrEnd > arrStart) {
        return JSON.parse(text.slice(arrStart, arrEnd + 1));
      }
    } catch {
      // Fall through
    }
    return null;
  }

  private async fetchLatestVersion(
    packageName: string,
  ): Promise<string | null> {
    try {
      const results = await this.search.search(`npm ${packageName} latest version`);
      if (results.length > 0) {
        const match = results[0]?.snippet.match(/(\d+\.\d+\.\d+)/);
        return match?.[1] ?? null;
      }
    } catch {
      // Fall through
    }
    return null;
  }

  private extractProfileFromFindings(
    findings: Finding[],
  ): SkillDocument | null {
    if (findings.length === 0) return null;

    const categories = [...new Set(findings.map((f) => f.category))];
    const slug = `jarvis-pattern-${categories.join("-")}`;

    return {
      name: `Jarvis Pattern: ${categories.join(", ")}`,
      description: `Auto-generated profile for recurring ${categories.join("/")} patterns detected by Jarvis scan.`,
      tags: ["jarvis", "auto-generated", ...categories],
      steps: [
        "Run Jarvis codebase scan",
        `Identify ${categories.join(", ")} patterns`,
        "Review findings and prioritize fixes",
        "Apply automated fixes where possible",
        "Track improvements in kanban",
      ],
      createdAt: new Date().toISOString(),
      usageCount: 1,
      successRate: 1.0,
    };
  }
}
