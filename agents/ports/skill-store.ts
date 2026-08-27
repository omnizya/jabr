import type { SkillDocument } from "../types.ts";

export interface SkillStorePort {
  save(slug: string, doc: SkillDocument): boolean;
  exists(slug: string): boolean;
  list(): string[];
}
