import type {
  MemoryStorePort,
  SessionData,
} from "@ports/memory-store";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo-root `memory/` directory relative to this module's location
// (agents/adapters/memory-fs.ts -> ../../memory) instead of process.cwd(),
// which is fragile when the process is started from another directory.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MEMORY_DIR = join(MODULE_DIR, "..", "..", "memory");

export interface MemoryFSOptions {
  /** Base directory for memory files. Defaults to the repo-root `memory/`. */
  baseDir?: string;
  /** Memory file name within baseDir. Defaults to `orchestrator.md`. */
  file?: string;
}

export class MemoryFS implements MemoryStorePort {
  private readonly filePath: string;

  constructor(opts?: MemoryFSOptions) {
    const baseDir = opts?.baseDir ?? DEFAULT_MEMORY_DIR;
    const file = opts?.file ?? "orchestrator.md";
    this.filePath = join(baseDir, file);
  }

  read(): string {
    if (!existsSync(this.filePath)) return "";
    return readFileSync(this.filePath, "utf-8");
  }

  append(entry: string): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, "\n\n" + entry, "utf-8");
  }

  private sessionsDir(): string {
    return join(dirname(this.filePath), "sessions");
  }

  private sessionPath(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.sessionsDir(), `session-${safe}.json`);
  }

  listSessions(): string[] {
    const dir = this.sessionsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .map((f) => f.slice("session-".length, -".json".length));
  }

  deleteSession(id: string): boolean {
    const p = this.sessionPath(id);
    if (!existsSync(p)) return false;
    rmSync(p);
    return true;
  }

  getSession(id: string): SessionData | null {
    const p = this.sessionPath(id);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as SessionData;
    } catch (e) {
      console.error(`[MemoryFS] failed to read session ${id}: ${e}`);
      return null;
    }
  }

  saveSession(id: string, data: SessionData): void {
    const p = this.sessionPath(id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  }
}
