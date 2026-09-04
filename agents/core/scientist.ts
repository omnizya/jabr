import type { AgentCard, AgentSkill } from "@agents/types";
import { jabrUrlForPort } from "@config/jabr-config";
import { JABR_PORTS } from "@constants/ecosystem";
import type { McpToolPort } from "@ports/mcp-tool-port";

export class ScientistAgent {
	public readonly card: AgentCard = {
		name: "KHWARIZMI",
		description:
			"KHWARIZMI (Al-Khwarizmi) — Master of Calculation. Specialist in data science, scripting, and technical analysis. Uses Python to execute code and analyze data.",
		url: jabrUrlForPort(JABR_PORTS.scientist),
		version: "1.0.0",
		capabilities: {
			streaming: false,
			pushNotifications: false,
			stateTransitionHistory: true,
		},
		securitySchemes: {},
		securityRequirements: [],
		supportedInterfaces: ["a2a" as any],
		skills: [
			{
				name: "Data Analysis",
				description:
					"Write and execute Python scripts to analyze datasets, perform statistics, and generate insights.",
				tags: [
					"python",
					"data",
					"analysis",
					"script",
					"scientist",
					"stats",
					"csv",
					"json",
				],
			},
			{
				name: "Technical Scripting",
				description:
					"Create utility scripts for automation or technical validation.",
				tags: ["automation", "scripting", "python", "utility"],
			},
		],
		pricing: { costPerTask: 30 },
	};

	constructor(private mcpTools: McpToolPort) {}

	async execute(taskId: string, text: string): Promise<string> {
		console.log(`[Scientist] working on task ${taskId}`);
		if (
			text.toLowerCase().includes("python") ||
			text.toLowerCase().includes("analyze")
		) {
			const script = `print("Scientist analyzing: ${text}")\n# Logic would go here\nprint("Analysis complete: Result is 42")`;

			try {
				const result = await this.mcpTools.callTool("run_python", {
					code: script,
				});
				return `Scientist executed analysis:\n\n${result.content}`;
			} catch (e) {
				return `Scientist failed to execute script: ${e}`;
			}
		}

		return "I can help with Python scripts and data analysis. Please describe the data or script you need.";
	}
}
