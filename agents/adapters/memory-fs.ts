import type { MemoryStorePort } from "../ports/memory-store.ts";
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

/** Filesystem adapter for append-only session memory. */
export class MemoryFS implements MemoryStorePort {
  constructor(private filePath: string = "memory/orchestrator.md") {}

  read(): string {
    if (!existsSync(this.filePath)) return "";
    return readFileSync(this.filePath, "utf-8");
  }

  append(entry: string): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, "\n\n" + entry, "utf-8");
  }
}
