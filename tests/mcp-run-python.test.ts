import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { McpClientAdapter } from "@adapters/mcp/mcp-client";
import { NullElicitationPort } from "@ports/elicitation-port";

describe("run_python MCP tool (Scientist Python execution)", () => {
	let adapter: McpClientAdapter;

	beforeAll(async () => {
		adapter = new McpClientAdapter(NullElicitationPort);
		// Force client spawn and connection
		await adapter.callTool("calculate", { expression: "1+1" });
	});

	test("executes Python code and returns stdout", async () => {
		const result = await adapter.callTool("run_python", {
			code: 'print("hello from scientist")',
		});
		expect(result.isError).not.toBe(true);
		expect(result.content).toContain("hello from scientist");
	});

	test("executes Python with imports", async () => {
		const result = await adapter.callTool("run_python", {
			code: "import sys\nprint(f'Python {sys.version_info.major}.{sys.version_info.minor}')",
		});
		expect(result.isError).not.toBe(true);
		expect(result.content).toContain("Python 3.");
	});
});
