import type { SkillDocument } from "../types.ts";

/**
 * Outbound port: save/list skill documents (self-improvement loop).
 * Adapter: filesystem (skills/*.json).
 */
export interface SkillStorePort {
  /** Save a skill. Returns false if slug already exists (idempotent). */
  save(slug: string, doc: SkillDocument): boolean;
  exists(slug: string): boolean;
  list(): string[];
}
