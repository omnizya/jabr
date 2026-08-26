import type { SkillStorePort } from "../ports/skill-store.ts";
import type { SkillDocument } from "../types.ts";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Filesystem adapter for skill documents (skills/*.json). */
export class SkillFS implements SkillStorePort {
  constructor(private dir: string = "skills") {
    mkdirSync(this.dir, { recursive: true });
  }

  save(slug: string, doc: SkillDocument): boolean {
    const path = join(this.dir, slug + ".json");
    if (existsSync(path)) return false;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(path, JSON.stringify(doc, null, 2), "utf-8");
    return true;
  }

  exists(slug: string): boolean {
    return existsSync(join(this.dir, slug + ".json"));
  }

  list(): string[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  }
}
