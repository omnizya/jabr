import { describe, expect, test } from "bun:test";
import {
	type A2AArtifact,
	type A2APart,
	createDataArtifact,
	createFileArtifact,
	createMultipartArtifact,
	createTextArtifact,
} from "@agents/types";

describe("Typed Artifacts (A2A v1.0)", () => {
	test("createTextArtifact builds a single-text-part artifact", () => {
		const a = createTextArtifact("art-1", "hello world", "greeting");
		expect(a.artifactId).toBe("art-1");
		expect(a.name).toBe("greeting");
		expect(a.parts).toEqual([{ kind: "text", text: "hello world" }]);
	});

	test("createFileArtifact builds a base64 file part", () => {
		const a = createFileArtifact(
			"art-2",
			"SGVsbG8gV29ybGQ=",
			"text/plain",
			"hello.txt",
			"myfile",
		);
		expect(a.artifactId).toBe("art-2");
		expect(a.name).toBe("myfile");
		expect(a.parts.length).toBe(1);
		const part = a.parts[0] as {
			kind: "file";
			file: { base64: string; mimeType?: string; filename?: string };
		};
		expect(part.kind).toBe("file");
		expect(part.file.base64).toBe("SGVsbG8gV29ybGQ=");
		expect(part.file.mimeType).toBe("text/plain");
		expect(part.file.filename).toBe("hello.txt");
	});

	test("createDataArtifact builds a structured data part", () => {
		const payload = { x: 1, y: [2, 3], label: "point" };
		const a = createDataArtifact(
			"art-3",
			payload,
			"application/json",
			"coords",
		);
		expect(a.artifactId).toBe("art-3");
		expect(a.name).toBe("coords");
		expect(a.parts.length).toBe(1);
		const part = a.parts[0] as {
			kind: "data";
			data: typeof payload;
			mimeType?: string;
		};
		expect(part.kind).toBe("data");
		expect(part.data).toEqual(payload);
		expect(part.mimeType).toBe("application/json");
	});

	test("createMultipartArtifact assembles mixed parts", () => {
		const parts: A2APart[] = [
			{ kind: "text", text: "Report:" },
			{ kind: "data", data: { score: 0.95 } },
			{
				kind: "file",
				file: { base64: "AAAA", mimeType: "image/png", filename: "chart.png" },
			},
		];
		const a = createMultipartArtifact("art-4", parts, "full-report");
		expect(a.artifactId).toBe("art-4");
		expect(a.name).toBe("full-report");
		expect(a.parts.length).toBe(3);
		expect(a.parts[0]!.kind).toBe("text");
		expect(a.parts[1]!.kind).toBe("data");
		expect(a.parts[2]!.kind).toBe("file");
	});

	test("A2AArtifact supports optional description, metadata, extensions", () => {
		const a: A2AArtifact = {
			artifactId: "art-5",
			name: "rich",
			description: "A rich artifact with metadata",
			parts: [{ kind: "text", text: "body" }],
			metadata: { generatedBy: "oracle", confidence: 0.9 },
			extensions: ["https://example.com/ext/v1"],
		};
		expect(a.description).toBe("A rich artifact with metadata");
		expect(a.metadata).toEqual({ generatedBy: "oracle", confidence: 0.9 });
		expect(a.extensions).toEqual(["https://example.com/ext/v1"]);
	});

	test("A2APart union discriminates by kind", () => {
		const textPart: A2APart = { kind: "text", text: "hi" };
		const filePart: A2APart = { kind: "file", file: { base64: "AA==" } };
		const dataPart: A2APart = { kind: "data", data: { v: 1 } };

		// Narrowing via kind discriminator
		const describe = (p: A2APart): string => {
			switch (p.kind) {
				case "text":
					return `text:${p.text}`;
				case "file":
					return `file:${p.file.base64}`;
				case "data":
					return `data:${JSON.stringify(p.data)}`;
			}
		};

		expect(describe(textPart)).toBe("text:hi");
		expect(describe(filePart)).toBe("file:AA==");
		expect(describe(dataPart)).toBe('data:{"v":1}');
	});
});
