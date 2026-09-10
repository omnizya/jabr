import { readFileSync } from "node:fs";

export function formDataWithFile(data: Buffer, name?: string): FormData {
	const fd = new FormData();
	const blob = new Blob([data], { type: "application/octet-stream" });
	fd.append("file", blob, name ?? "artifact");
	return fd;
}

/**
 * Read a PEM file and return its contents as a string.
 */
export function readPemFileSync(path: string): string {
	return readFileSync(path, "utf-8");
}
