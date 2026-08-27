import type { AgentCard, AgentSkill } from "@agents/types";
import type { McpToolPort } from "@agents/ports/mcp-tool-port";

export class ScientistAgent {
  public readonly card: AgentCard = {
    name: "Scientist Agent",
    description: "Specialist in data science, scripting, and technical analysis. Uses Python to execute code and analyze data.",
    supportedInterfaces: ["a2a" as any],
    skills: [
      {
        name: "Data Analysis",
        description: "Write and execute Python scripts to analyze datasets, perform statistics, and generate insights.",
        tags: ["python", "data", "analysis", "script", "scientist", "stats", "csv", "json"],
      },
      {
        name: "Technical Scripting",
        description: "Create utility scripts for automation or technical validation.",
        tags: ["automation", "scripting", "python", "utility"],
      }
    ],
  };

  constructor(private mcpTools: McpToolPort) {}

  async handleTask(text: string): Promise<string> {
    if (text.toLowerCase().includes("python") || text.toLowerCase().includes("analyze")) {
      const script = `print("Scientist analyzing: ${text}")\n# Logic would go here\nprint("Analysis complete: Result is 42")`;
      
      try {
        const result = await this.mcpTools.callTool("run_python", { code: script });
        return `Scientist executed analysis:\n\n${result.content}`;
      } catch (e) {
        return `Scientist failed to execute script: ${e}`;
      }
    }

    return "I can help with Python scripts and data analysis. Please describe the data or script you need.";
  }
}
