import type { SkillStorePort } from "@ports/skill-store";
import type { SkillDocument } from "@agents/types";
import { writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export class SkillFS implements SkillStorePort {
  constructor(private dir: string = "skills") {
    mkdirSync(this.dir, { recursive: true });
  }

  save(slug: string, doc: SkillDocument): boolean {
    const path = join(this.dir, slug + ".json");
    if (existsSync(path)) return false;
    mkdirSync(this.dir, { recursive: true });
    try {
      writeFileSync(path, JSON.stringify(doc, null, 2), "utf-8");
    } catch (e) {
      console.error(`[SkillFS] failed to write skill ${slug}: ${e}`);
      throw e;
    }
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
