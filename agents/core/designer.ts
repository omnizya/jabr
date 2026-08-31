import type { AgentCard } from "@agents/types";
import type { ImageGenPort } from "@ports/image-gen-port";
import type { TaskStorePort } from "@ports/task-store";

export const DESIGNER_CARD: AgentCard = {
	name: "FIRNAS",
	description:
		"FIRNAS (Abbas ibn Firnas) — Flying Polymath. Designs UI/UX, creates responsive layouts, applies visual polish. Frontend design specialist.",
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
			name: "Layout design",
			description:
				"Creates responsive layouts with proper hierarchy and spacing",
			tags: ["layout", "responsive", "grid", "spacing", "ui"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
		{
			name: "Component design",
			description:
				"Designs UI components with accessibility and interaction patterns",
			tags: ["component", "accessibility", "interaction", "button", "ux"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
		{
			name: "Style guide",
			description:
				"Creates color palettes, typography scales, and design tokens",
			tags: ["color", "palette", "theme", "typography", "design-tokens"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
	],
	pricing: { costPerTask: 12 },
};

export class DesignerAgent {
	constructor(
		private taskStore: TaskStorePort,
		private imageGen?: ImageGenPort,
	) {}

	get card(): AgentCard {
		return DESIGNER_CARD;
	}

	executeTask(userText: string): string {
		const lower = userText.toLowerCase();

		if (
			lower.includes("layout") ||
			lower.includes("page") ||
			lower.includes("responsive")
		) {
			return `## Layout Design\n\nFor: "${userText}"\n\n**Recommended approach**:\n1. Mobile-first responsive grid (CSS Grid or Flexbox)\n2. Max-width container (1200px) with auto margins\n3. Breakpoints: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)\n4. Consistent spacing scale: 4px base (4, 8, 12, 16, 24, 32, 48, 64)\n5. Visual hierarchy: clear heading levels, sufficient contrast\n\n**Component suggestions**: Hero section → Features grid → CTA → Footer\n\nUse the Fixer agent to implement the CSS/HTML after design is approved.`;
		}

		if (
			lower.includes("component") ||
			lower.includes("button") ||
			lower.includes("card") ||
			lower.includes("modal")
		) {
			return `## Component Design\n\nFor: "${userText}"\n\n**Design tokens**:\n- Border radius: 8px (sm), 12px (md), 16px (lg)\n- Shadows: 0 1px 3px rgba(0,0,0,0.1) (sm), 0 4px 12px rgba(0,0,0,0.15) (md)\n- Transitions: 150ms ease-out (interactive), 300ms ease-in-out (layout)\n\n**Accessibility**:\n- Minimum touch target: 44x44px\n- Focus visible ring: 2px solid currentColor, offset 2px\n- Color contrast: WCAG AA (4.5:1 text, 3:1 large text)\n\nDelegate implementation to Fixer agent.`;
		}

		if (
			lower.includes("color") ||
			lower.includes("palette") ||
			lower.includes("theme") ||
			lower.includes("style")
		) {
			return `## Style Guide\n\nFor: "${userText}"\n\n**Color palette**:\n- Primary: #2563EB (blue-600)\n- Secondary: #7C3AED (violet-600)\n- Neutral: #111827 → #F9FAFB (gray-900 to gray-50)\n- Success: #059669, Warning: #D97706, Error: #DC2626\n\n**Typography**:\n- Headings: Inter, 700 weight\n- Body: Inter, 400 weight, 1.6 line-height\n- Code: JetBrains Mono, 14px\n\n**Dark mode**: Swap neutral scale, reduce saturation 10%, use #0F172A background.`;
		}

		return `Designer ready. Ask me to:\n- Design a page layout or responsive grid\n- Create a UI component with interaction patterns\n- Generate a color palette or style guide`;
	}

	async render(prompt: string): Promise<string> {
		if (!this.imageGen) {
			return "Image generation is not configured for this Designer agent.";
		}
		try {
			const url = await this.imageGen.generate(prompt);
			return `![Generated visual](${url})\n\nPrompt: ${prompt}`;
		} catch (err) {
			return `Image generation failed: ${String(err)}`;
		}
	}

	async execute(taskId: string, userText: string): Promise<void> {
		console.log(`[Designer] executing design task ${taskId}`);
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
