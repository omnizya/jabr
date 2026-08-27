export type SessionRole = "user" | "agent" | "tool";

export interface SessionEntry {
  role: SessionRole;
  content: unknown;
  timestamp: string;
}

export interface SessionData {
  id: string;
  cursor?: string;
  history: SessionEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStorePort {
  read(): string;
  append(entry: string): void;
  listSessions(): string[];
  deleteSession(id: string): boolean;
  getSession(id: string): SessionData | null;
  saveSession(id: string, data: SessionData): void;
}
