import type { SkillDocument } from "@agents/types";

export interface SkillStorePort {
  save(slug: string, doc: SkillDocument): boolean;
  exists(slug: string): boolean;
  list(): string[];
}

console.log("[SkillStorePort] port interface loaded");
